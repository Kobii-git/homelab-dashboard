import { getApiError } from "./api";
import { pushToast } from "./toast";

export async function runFormAction(
  action: () => Promise<void>,
  setError: (message: string | null) => void,
  setSubmitting?: (value: boolean) => void,
  successMessage?: string
): Promise<boolean> {
  setError(null);
  setSubmitting?.(true);

  try {
    await action();
    if (successMessage) {
      pushToast(successMessage);
    }
    return true;
  } catch (error) {
    const message = getApiError(error);
    setError(message);
    pushToast(message, "error");
    return false;
  } finally {
    setSubmitting?.(false);
  }
}

export function FormErrorBanner({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }

  return <p className="form-error">{message}</p>;
}
