/**
 * Opens Sentry's feedback form. Returns false when feedback is not configured
 * on this deployment, so the caller can say so instead of doing nothing.
 *
 * The SDK is imported lazily so a footer link does not pull it into a page's
 * first load.
 */
export interface FeedbackUser { email?: string | null; name?: string | null }

export async function openFeedbackForm(user?: FeedbackUser): Promise<boolean> {
  const Sentry = await import("@sentry/nextjs");
  const feedback = Sentry.getFeedback();
  if (!feedback) return false;
  // The form reads name and email from the Sentry user.
  if (user?.email) Sentry.setUser({ email: user.email, ...(user.name ? { username: user.name } : {}) });
  const form = await feedback.createForm();
  form.appendToDom();
  form.open();
  return true;
}
