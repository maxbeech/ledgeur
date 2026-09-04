// Native system-audio capture via macOS's Core Audio "Process Tap" API
// (AudioHardwareCreateProcessTap, macOS 14.2+). This is the alternative to
// getDisplayMedia's screen-share picker for hearing the other side of a call:
// no picker dialog, no video, no menu-bar recording indicator — just a
// one-time "Screen & System Audio Recording" permission grant, the same
// category macOS already uses for this capability.
//
// Modelled closely on Apple's own reference sample
// (github.com/insidegui/AudioCap, ProcessTap.swift + CoreAudioUtils.swift,
// fetched in full while building this), adapted from "tap one process" to
// "tap everything except us": a meeting's audio can come from any app (a
// browser tab, Zoom, Teams...), not one we can name in advance.
//
// Feature-gated (`system-audio-tap`) and macOS-only, same pattern as
// `ai/*`'s `native-ai`: the stub below returns an honest "unavailable"
// everywhere else rather than a silent no-op or a hang.
//
// PCM is delivered to the frontend as base64-encoded little-endian i16 mono
// samples over a Tauri event (`system-audio:chunk`) — see
// apps/desktop/src/lib/systemAudioTap.ts for the consumer.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SystemAudioChunk {
    /// Base64-encoded little-endian i16 mono PCM.
    pub pcm_base64: String,
    pub sample_rate: u32,
}

pub const SYSTEM_AUDIO_EVENT: &str = "system-audio:chunk";

#[cfg(not(all(target_os = "macos", feature = "system-audio-tap")))]
mod inner {
    use super::*;
    pub fn available() -> bool {
        false
    }
    pub fn start(_app: &AppHandle) -> Result<(), String> {
        Err("System audio capture isn't available in this build.".into())
    }
    pub fn stop() -> Result<(), String> {
        Ok(())
    }
}

#[cfg(all(target_os = "macos", feature = "system-audio-tap"))]
mod inner {
    use super::*;
    use std::ffi::c_void;
    use std::ptr::NonNull;
    use std::sync::Mutex;

    use block2::RcBlock;
    use objc2::AnyThread;
    use objc2_core_audio::{
        AudioDeviceCreateIOProcIDWithBlock, AudioDeviceDestroyIOProcID, AudioDeviceIOProcID,
        AudioDeviceStart, AudioDeviceStop, AudioHardwareCreateAggregateDevice,
        AudioHardwareCreateProcessTap, AudioHardwareDestroyAggregateDevice,
        AudioHardwareDestroyProcessTap, AudioObjectGetPropertyData, AudioObjectID,
        AudioObjectPropertyAddress, CATapDescription, CATapMuteBehavior,
        kAudioDevicePropertyDeviceUID, kAudioHardwarePropertyDefaultSystemOutputDevice,
        kAudioHardwarePropertyTranslatePIDToProcessObject, kAudioObjectPropertyElementMain,
        kAudioObjectPropertyScopeGlobal, kAudioObjectSystemObject,
        kAudioAggregateDeviceIsPrivateKey, kAudioAggregateDeviceIsStackedKey,
        kAudioAggregateDeviceMainSubDeviceKey, kAudioAggregateDeviceNameKey,
        kAudioAggregateDeviceSubDeviceListKey, kAudioAggregateDeviceTapAutoStartKey,
        kAudioAggregateDeviceTapListKey, kAudioAggregateDeviceUIDKey, kAudioSubDeviceUIDKey,
        kAudioSubTapDriftCompensationKey, kAudioSubTapUIDKey,
    };
    use objc2_core_audio_types::{AudioBufferList, AudioTimeStamp};
    use objc2_core_foundation::{CFArray, CFBoolean, CFDictionary, CFRetained, CFString, CFType};
    use objc2_foundation::{NSArray, NSNumber, NSUUID};

    type IoBlockFn = dyn Fn(
        NonNull<AudioTimeStamp>,
        NonNull<AudioBufferList>,
        NonNull<AudioTimeStamp>,
        NonNull<AudioBufferList>,
        NonNull<AudioTimeStamp>,
    );

    /// Everything torn down together on stop — see `teardown()`. The IO block
    /// must outlive the IOProc registration: dropping it early would leave
    /// the aggregate device calling into freed memory.
    struct TapState {
        tap_id: AudioObjectID,
        aggregate_id: AudioObjectID,
        proc_id: AudioDeviceIOProcID,
        _io_block: RcBlock<IoBlockFn>,
    }
    // The Core Audio object IDs are plain integers and the block is only ever
    // touched by Core Audio's own IO thread and this module's start/stop —
    // never concurrently with itself.
    unsafe impl Send for TapState {}

    static STATE: Mutex<Option<TapState>> = Mutex::new(None);

    pub fn available() -> bool {
        // No cheap, honest way to probe "will AudioHardwareCreateProcessTap
        // succeed" without actually creating a tap — macOS versions before
        // 14.2 don't have the symbol at all, but this app's minimum deployment
        // target already assumes a modern OS. Real unavailability (an older
        // OS, no permission yet) surfaces as a normal error from `start`.
        true
    }

    fn check(err: i32, what: &str) -> Result<(), String> {
        if err == 0 {
            Ok(())
        } else {
            Err(format!("{what} failed (OSStatus {err})."))
        }
    }

    fn address(selector: u32) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress {
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain,
        }
    }

    /// Read a fixed-size property (an `AudioObjectID`/`pid_t`-shaped value)
    /// with an optional qualifier (e.g. a pid to translate).
    fn read_u32_property(
        object_id: AudioObjectID,
        selector: u32,
        qualifier: Option<i32>,
    ) -> Result<u32, String> {
        let mut addr = address(selector);
        let mut value: u32 = 0;
        let mut size = std::mem::size_of::<u32>() as u32;
        let (q_ptr, q_size) = match &qualifier {
            Some(q) => (q as *const i32 as *const c_void, std::mem::size_of::<i32>() as u32),
            None => (std::ptr::null(), 0u32),
        };
        let err = unsafe {
            AudioObjectGetPropertyData(
                object_id,
                NonNull::from(&mut addr),
                q_size,
                q_ptr,
                NonNull::from(&mut size),
                NonNull::new(&mut value as *mut u32 as *mut c_void).unwrap(),
            )
        };
        check(err, "AudioObjectGetPropertyData")?;
        Ok(value)
    }

    fn read_default_system_output_device() -> Result<AudioObjectID, String> {
        read_u32_property(
            kAudioObjectSystemObject as AudioObjectID,
            kAudioHardwarePropertyDefaultSystemOutputDevice,
            None,
        )
    }

    fn translate_pid_to_process_object(pid: i32) -> Result<AudioObjectID, String> {
        let id = read_u32_property(
            kAudioObjectSystemObject as AudioObjectID,
            kAudioHardwarePropertyTranslatePIDToProcessObject,
            Some(pid),
        )?;
        if id == 0 {
            return Err("This process has no audio process object yet (nothing played audio).".into());
        }
        Ok(id)
    }

    fn read_device_uid(device_id: AudioObjectID) -> Result<String, String> {
        let mut addr = address(kAudioDevicePropertyDeviceUID);
        let mut value: *const CFString = std::ptr::null();
        let mut size = std::mem::size_of::<*const CFString>() as u32;
        let err = unsafe {
            AudioObjectGetPropertyData(
                device_id,
                NonNull::from(&mut addr),
                0,
                std::ptr::null(),
                NonNull::from(&mut size),
                NonNull::new(&mut value as *mut *const CFString as *mut c_void).unwrap(),
            )
        };
        check(err, "read device UID")?;
        let ptr = NonNull::new(value as *mut CFString).ok_or("no device UID returned")?;
        // AudioObjectGetPropertyData hands over a +1 reference for CF-typed
        // properties — this takes ownership so it's released on drop instead
        // of leaked.
        let cf = unsafe { CFRetained::from_raw(ptr) };
        Ok(cf.to_string())
    }

    /// Build the private aggregate device that bridges the process tap with
    /// real audio I/O — the tap alone has no clock of its own. Mirrors
    /// ProcessTap.swift's dictionary exactly (keys verified against Apple's
    /// reference sample rather than guessed).
    fn build_aggregate_description(
        tap_uuid: &str,
        aggregate_uid: &str,
        output_device_uid: &str,
    ) -> CFRetained<CFDictionary<CFString, CFType>> {
        let cf_key = |k: &std::ffi::CStr| CFString::from_str(k.to_str().unwrap());
        let cf_str = |s: &str| CFString::from_str(s);

        let sub_device_uid = cf_str(output_device_uid);
        let sub_device_entry = CFDictionary::<CFString, CFType>::from_slices(
            &[&*cf_key(kAudioSubDeviceUIDKey)],
            &[sub_device_uid.as_ref()],
        );
        let sub_device_list = CFArray::<CFType>::from_objects(&[sub_device_entry.as_ref()]);

        let drift = CFBoolean::new(true);
        let tap_uid_str = cf_str(tap_uuid);
        let tap_entry = CFDictionary::<CFString, CFType>::from_slices(
            &[
                &*cf_key(kAudioSubTapDriftCompensationKey),
                &*cf_key(kAudioSubTapUIDKey),
            ],
            &[drift.as_ref(), tap_uid_str.as_ref()],
        );
        let tap_list = CFArray::<CFType>::from_objects(&[tap_entry.as_ref()]);

        let name = cf_str("Ledgeur System Audio");
        let uid = cf_str(aggregate_uid);
        let main_sub_device = cf_str(output_device_uid);
        let is_private = CFBoolean::new(true);
        let is_stacked = CFBoolean::new(false);
        let auto_start = CFBoolean::new(true);

        CFDictionary::<CFString, CFType>::from_slices(
            &[
                &*cf_key(kAudioAggregateDeviceNameKey),
                &*cf_key(kAudioAggregateDeviceUIDKey),
                &*cf_key(kAudioAggregateDeviceMainSubDeviceKey),
                &*cf_key(kAudioAggregateDeviceIsPrivateKey),
                &*cf_key(kAudioAggregateDeviceIsStackedKey),
                &*cf_key(kAudioAggregateDeviceTapAutoStartKey),
                &*cf_key(kAudioAggregateDeviceSubDeviceListKey),
                &*cf_key(kAudioAggregateDeviceTapListKey),
            ],
            &[
                name.as_ref(),
                uid.as_ref(),
                main_sub_device.as_ref(),
                is_private.as_ref(),
                is_stacked.as_ref(),
                auto_start.as_ref(),
                sub_device_list.as_ref(),
                tap_list.as_ref(),
            ],
        )
    }

    /// Downmix an `AudioBufferList` (whatever channel count/layout the tap's
    /// format is) to mono i16 PCM, matching what the webview's Whisper/
    /// diarizer pipeline already expects from `AudioCapture`.
    fn buffer_list_to_mono_i16(list: &AudioBufferList) -> Vec<i16> {
        let n = list.mNumberBuffers as usize;
        let buffers = unsafe {
            std::slice::from_raw_parts(list.mBuffers.as_ptr(), n.max(1)).get(0..n).unwrap_or(&[])
        };
        let Some(first) = buffers.first() else { return Vec::new() };
        let channels = first.mNumberChannels.max(1) as usize;
        let frame_count = if channels > 0 {
            (first.mDataByteSize as usize / 4) / channels
        } else {
            0
        };
        let data = first.mData as *const f32;
        if data.is_null() || frame_count == 0 {
            return Vec::new();
        }
        let samples = unsafe { std::slice::from_raw_parts(data, frame_count * channels) };
        let mut out = Vec::with_capacity(frame_count);
        for frame in 0..frame_count {
            let mut sum = 0.0f32;
            for ch in 0..channels {
                sum += samples[frame * channels + ch];
            }
            let mono = (sum / channels as f32).clamp(-1.0, 1.0);
            out.push((mono * i16::MAX as f32) as i16);
        }
        out
    }

    pub fn start(app: &AppHandle) -> Result<(), String> {
        let mut guard = STATE.lock().map_err(|_| "audio tap lock poisoned".to_string())?;
        if guard.is_some() {
            return Ok(()); // already running
        }

        // Global tap excluding our own process, so Ledgeur's own UI sounds
        // (there are none today, but never say never) don't loop back into
        // the transcript.
        let our_pid = std::process::id() as i32;
        let exclude = match translate_pid_to_process_object(our_pid) {
            Ok(id) => NSArray::from_retained_slice(&[NSNumber::new_usize(id as usize)]),
            // We haven't played any audio yet, so we have no process object —
            // nothing to exclude.
            Err(_) => NSArray::new(),
        };
        let tap_description = unsafe {
            CATapDescription::initStereoGlobalTapButExcludeProcesses(
                CATapDescription::alloc(),
                &exclude,
            )
        };
        let tap_uuid = NSUUID::new();
        unsafe { tap_description.setUUID(&tap_uuid) };
        unsafe { tap_description.setMuteBehavior(CATapMuteBehavior::Unmuted) };

        let mut tap_id: AudioObjectID = 0;
        let err = unsafe {
            AudioHardwareCreateProcessTap(Some(&tap_description), &mut tap_id)
        };
        check(err, "AudioHardwareCreateProcessTap")?;

        let result = (|| -> Result<TapState, String> {
            let output_device = read_default_system_output_device()?;
            let output_uid = read_device_uid(output_device)?;
            let aggregate_uid = uuid_string();
            let tap_uuid_string = tap_uuid.UUIDString().to_string();

            let description = build_aggregate_description(&tap_uuid_string, &aggregate_uid, &output_uid);

            let mut aggregate_id: AudioObjectID = 0;
            let err = unsafe {
                AudioHardwareCreateAggregateDevice(description.as_ref(), NonNull::from(&mut aggregate_id))
            };
            check(err, "AudioHardwareCreateAggregateDevice")?;

            let handle = app.clone();
            let io_block: RcBlock<IoBlockFn> = RcBlock::new(
                move |_now: NonNull<AudioTimeStamp>,
                      input_data: NonNull<AudioBufferList>,
                      _input_time: NonNull<AudioTimeStamp>,
                      _output_data: NonNull<AudioBufferList>,
                      _output_time: NonNull<AudioTimeStamp>| {
                    let mono = buffer_list_to_mono_i16(unsafe { input_data.as_ref() });
                    if mono.is_empty() {
                        return;
                    }
                    let mut bytes = Vec::with_capacity(mono.len() * 2);
                    for s in &mono {
                        bytes.extend_from_slice(&s.to_le_bytes());
                    }
                    let chunk = SystemAudioChunk {
                        pcm_base64: base64_encode(&bytes),
                        sample_rate: 48_000,
                    };
                    let _ = handle.emit(SYSTEM_AUDIO_EVENT, chunk);
                },
            );

            let mut proc_id: AudioDeviceIOProcID = None;
            let err = unsafe {
                AudioDeviceCreateIOProcIDWithBlock(
                    NonNull::from(&mut proc_id),
                    aggregate_id,
                    None,
                    RcBlock::as_ptr(&io_block),
                )
            };
            check(err, "AudioDeviceCreateIOProcIDWithBlock")?;

            let err = unsafe { AudioDeviceStart(aggregate_id, proc_id) };
            check(err, "AudioDeviceStart")?;

            Ok(TapState { tap_id, aggregate_id, proc_id, _io_block: io_block })
        })();

        match result {
            Ok(state) => {
                *guard = Some(state);
                Ok(())
            }
            Err(e) => {
                // The tap itself was already created — clean it up before
                // surfacing the error, or it leaks until the process exits.
                unsafe { AudioHardwareDestroyProcessTap(tap_id) };
                Err(e)
            }
        }
    }

    pub fn stop() -> Result<(), String> {
        let mut guard = STATE.lock().map_err(|_| "audio tap lock poisoned".to_string())?;
        let Some(state) = guard.take() else { return Ok(()) };
        // Same order as Apple's reference: stop → destroy IO proc → destroy
        // aggregate device → destroy the tap.
        unsafe { AudioDeviceStop(state.aggregate_id, state.proc_id) };
        unsafe { AudioDeviceDestroyIOProcID(state.aggregate_id, state.proc_id) };
        unsafe { AudioHardwareDestroyAggregateDevice(state.aggregate_id) };
        unsafe { AudioHardwareDestroyProcessTap(state.tap_id) };
        Ok(())
    }

    fn uuid_string() -> String {
        NSUUID::new().UUIDString().to_string()
    }

    fn base64_encode(bytes: &[u8]) -> String {
        const CHARS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
        for chunk in bytes.chunks(3) {
            let b0 = chunk[0];
            let b1 = *chunk.get(1).unwrap_or(&0);
            let b2 = *chunk.get(2).unwrap_or(&0);
            out.push(CHARS[(b0 >> 2) as usize] as char);
            out.push(CHARS[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
            out.push(if chunk.len() > 1 { CHARS[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char } else { '=' });
            out.push(if chunk.len() > 2 { CHARS[(b2 & 0x3f) as usize] as char } else { '=' });
        }
        out
    }
}

pub use inner::{available, start, stop};

#[tauri::command]
pub fn system_audio_tap_available() -> bool {
    available()
}

#[tauri::command]
pub fn start_system_audio_tap(app: AppHandle) -> Result<(), String> {
    start(&app)
}

#[tauri::command]
pub fn stop_system_audio_tap() -> Result<(), String> {
    stop()
}
