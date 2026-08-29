/* Простые векторные иконки площадок — без внешних библиотек. */

type IconProps = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  xmlns: "http://www.w3.org/2000/svg" as const,
});

export function TwitchIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} fill="currentColor" aria-hidden="true">
      <path d="M4 3h16v11.5l-4.5 4.5H12l-2.5 2.5H8V19H4V3Zm2 2v12h3v2l2-2h4l3-3V5H6Zm5 2h2v5h-2V7Zm4 0h2v5h-2V7Z" />
    </svg>
  );
}

export function YoutubeIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} fill="currentColor" aria-hidden="true">
      <path d="M21.6 7.2a2.5 2.5 0 0 0-1.76-1.77C18.25 5 12 5 12 5s-6.25 0-7.84.43A2.5 2.5 0 0 0 2.4 7.2C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 0 0 1.76 1.77C5.75 19 12 19 12 19s6.25 0 7.84-.43a2.5 2.5 0 0 0 1.76-1.77C22 15.2 22 12 22 12s0-3.2-.4-4.8ZM10 15.2V8.8l5.2 3.2L10 15.2Z" />
    </svg>
  );
}

export function VkIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} fill="currentColor" aria-hidden="true">
      <path d="M3 7.5C3 5.6 4.6 4 6.5 4h11C19.4 4 21 5.6 21 7.5v9c0 1.9-1.6 3.5-3.5 3.5h-11A3.5 3.5 0 0 1 3 16.5v-9Zm4.6 2.2c.2.9 1.1 3.4 3.3 4.6 1.8 1 2.6.4 2.9-.2.3-.6.5-2 .4-2.6 0-.2.1-.4.3-.4h1.7c.3 0 .4-.1.5-.3.1-.2.2-.6 0-1-.2-.5-1.6-1.7-2.3-1.9-.4-.1-.7-.1-1 .1-.4.3-.6 1-.6 1s-.3 1.6-1 2c-.6.3-1.2.1-1.7-.4-.6-.7-.9-1.8-.9-1.8s-.1-.3-.3-.4c-.2-.1-.7-.2-1.1-.1-.5.1-.7.4-.7.7 0 .2.4 1 .4 1Z" />
    </svg>
  );
}

export function KickIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} fill="currentColor" aria-hidden="true">
      <path d="M3 3h5v5h3V5.5h2V8h2V3h6v6h-2v2h-2v2h2v2h-2v3h-3v-3h-2v-2h-2v5H8v-3H3V3Z" />
    </svg>
  );
}

export function TiktokIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} fill="currentColor" aria-hidden="true">
      <path d="M16.5 3h-3v11.2a2.6 2.6 0 1 1-2.6-2.6c.3 0 .5 0 .8.1V8.4a5.7 5.7 0 1 0 4.8 5.6V8.1c1 .8 2.3 1.2 3.6 1.2V6.2a3.6 3.6 0 0 1-3.6-3.2Z" />
    </svg>
  );
}

export function GithubIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.1.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.1-1.47-1.1-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.88 1.52 2.3 1.08 2.87.82.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .83-.27 2.75 1.02a9.6 9.6 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.93.36.31.68.92.68 1.86v2.75c0 .27.18.59.69.48A10 10 0 0 0 12 2Z" />
    </svg>
  );
}
