import xss from "xss";

const sanitized = Symbol("sanitized");
export type SafeValue = { readonly value: string; readonly [sanitized]: true };
export type HTMLPart = string | number | SafeValue | null | undefined;

const isSafeValue = (value: HTMLPart): value is SafeValue => {
  return (
    Object.prototype.hasOwnProperty.call(value, sanitized) &&
    (value as { [sanitized]: boolean })[sanitized]
  );
};

const sanitizeValue = (value: HTMLPart): string => {
  if (value === null || value === undefined) {
    return "";
  }
  if (isSafeValue(value)) {
    return value.value;
  }
  return xss(String(value), { whiteList: {} });
};

export const unsafeValue = (value: string): SafeValue => {
  return { value, [sanitized]: true };
};

export const html = (
  strings: TemplateStringsArray,
  ...values: HTMLPart[]
): SafeValue => {
  const value = strings.reduce(
    (acc, str, i) => acc + str + sanitizeValue(values[i]),
    "",
  );
  return { value, [sanitized]: true };
};

export const css = html;

export const render = (value: SafeValue): string => {
  if (!isSafeValue(value)) {
    throw new Error("Value is not safe");
  }
  return value.value;
};
