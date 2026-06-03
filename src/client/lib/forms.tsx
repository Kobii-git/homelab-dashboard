import type { FormEvent } from "react";
import { getApiError } from "./api";
import { pushToast } from "./toast";

/** Capture the form synchronously — `event.currentTarget` is null after await. */
export async function runFormSubmit(
  event: FormEvent<HTMLFormElement>,
  action: (formData: FormData, form: HTMLFormElement) => Promise<void | "skip-reset">,
  setError: (message: string | null) => void,
  setSubmitting?: (value: boolean) => void,
  successMessage?: string
): Promise<boolean> {
  event.preventDefault();
  const form = event.currentTarget;

  return runFormAction(async () => {
    const result = await action(new FormData(form), form);
    if (result !== "skip-reset") {
      form.reset();
    }
  }, setError, setSubmitting, successMessage);
}

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
