"use client";

import { contactMailto } from "@/lib/email";

// Renders as a link visually, but never puts a mailto: href in the DOM —
// the address is only assembled and navigated to on click, so page-source
// scrapers find nothing to harvest.
export default function EmailLink({
  label,
  subject,
  className,
}: {
  label: string;
  subject?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        window.location.href = contactMailto(subject);
      }}
      className={className}
    >
      {label}
    </button>
  );
}
