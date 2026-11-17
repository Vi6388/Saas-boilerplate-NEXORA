/**
 * Local development demo only.
 * Never enable this for production billing.
 */
export function canSkipBillingForLocalDemo(): boolean {
  if (process.env.NODE_ENV !== 'development') {
    return false;
  }

  if (process.env.NEXT_PUBLIC_DEMO_SKIP_BILLING !== 'true') {
    return false;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  return (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  );
}