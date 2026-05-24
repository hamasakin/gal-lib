import { useEffect, useState, type ImgHTMLAttributes, type ReactNode } from "react";

interface SafeImageProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, "onError" | "src"> {
  /** Image URL. `null` / `undefined` / `""` are treated the same as load failure. */
  src: string | null | undefined;
  /**
   * React node rendered when `src` is empty or the image fails to load. If
   * omitted, nothing is rendered in the error state (the element simply
   * disappears from the layout — matching the legacy `display: none`
   * behaviour without the inline-style sticking problem).
   */
  fallback?: ReactNode;
}

/**
 * `<img>` wrapper that toggles to a React fallback on load error.
 *
 * Replaces the `onError={e => e.currentTarget.style.display = "none"}`
 * pattern scattered across the app (WR-02 in 260524 review). The inline
 * style approach is "one-way" — once display:none is written, setting
 * `src` to a valid URL later does not restore visibility, so any retry /
 * cache-buster path silently fails. `SafeImage` flips `errored` back to
 * `false` whenever `src` changes, so the next load attempt is rendered.
 */
export function SafeImage({
  src,
  fallback = null,
  ...imgProps
}: SafeImageProps) {
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setErrored(false);
  }, [src]);

  if (!src || errored) {
    return <>{fallback}</>;
  }
  return <img {...imgProps} src={src} onError={() => setErrored(true)} />;
}
