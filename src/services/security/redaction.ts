import type { LoginFieldInput } from "../../types/job";

export function redactText(value: string, visibleChars = 2): string {
  if (value.length <= visibleChars) {
    return "*".repeat(value.length || 1);
  }
  const suffix = value.slice(-visibleChars);
  return `${"*".repeat(Math.max(4, value.length - visibleChars))}${suffix}`;
}

export function redactLoginFields(fields: LoginFieldInput[] = []): Array<{
  name: string;
  selector?: string;
  value: string;
  secret: boolean;
}> {
  return fields.map((field) => ({
    name: field.name,
    selector: field.selector,
    secret: field.secret ?? false,
    value: field.secret ? redactText(field.value) : field.value,
  }));
}

export function maskError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replaceAll(/(password|token|secret)\s*[:=]\s*[^\s]+/gi, "$1=[REDACTED]");
  }
  return "Unknown error";
}
