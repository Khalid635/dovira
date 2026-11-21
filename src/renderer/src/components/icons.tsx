import type { ReactNode } from 'react'

export interface IconProps {
  size?: number
  className?: string
}

// Small inline SVG icons, 16px by default, drawn in currentColor so they
// follow text color in both themes. No emoji in the UI.
function Svg({
  size = 16,
  className,
  children
}: IconProps & { children: ReactNode }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function IconDownload(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M8 2v7.5" />
      <path d="M4.8 6.3 8 9.5l3.2-3.2" />
      <path d="M2.5 13.5h11" />
    </Svg>
  )
}

export function IconPause(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M6 3.5v9" />
      <path d="M10 3.5v9" />
    </Svg>
  )
}

export function IconPlay(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M5 3.2v9.6L12.4 8 5 3.2Z" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function IconClose(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Svg>
  )
}

export function IconFolder(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h2.6l1.4 2h5A1.5 1.5 0 0 1 14 7.5V12a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12V5.5Z" />
    </Svg>
  )
}

export function IconTrash(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M2.5 4h11" />
      <path d="M6.5 4V2.8A.8.8 0 0 1 7.3 2h1.4a.8.8 0 0 1 .8.8V4" />
      <path d="M4 4l.7 8.2a1 1 0 0 0 1 .8h4.6a1 1 0 0 0 1-.8L12 4" />
      <path d="M6.5 7v4M9.5 7v4" />
    </Svg>
  )
}

export function IconSettings(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2" />
    </Svg>
  )
}

export function IconVideo(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <rect x="1.5" y="3.5" width="13" height="9" rx="2" />
      <path d="M7 6.5v3l2.6-1.5L7 6.5Z" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function IconAudio(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M6 12.5V4l6-1.5V11" />
      <circle cx="4.3" cy="12.5" r="1.5" />
      <circle cx="10.3" cy="11" r="1.5" />
    </Svg>
  )
}

export function IconFile(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M4.5 2h4l3.5 3.5V13a1 1 0 0 1-1 1h-6.5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" />
      <path d="M8.5 2v3.5H12" />
    </Svg>
  )
}

export function IconAll(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M8 2.5 13.5 5 8 7.5 2.5 5 8 2.5Z" />
      <path d="M2.5 8.5 8 11l5.5-2.5" />
      <path d="M2.5 11 8 13.5 13.5 11" />
    </Svg>
  )
}

export function IconCheck(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M3 8.5 6.5 12 13 4.5" />
    </Svg>
  )
}

export function IconCheckCircle(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M5.2 8.2 7.4 10.4 11 6.4" />
    </Svg>
  )
}

export function IconClock(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4.5V8l2.5 1.5" />
    </Svg>
  )
}

export function IconLink(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M6.5 9.5a2.8 2.8 0 0 0 4 0l1.8-1.8a2.83 2.83 0 0 0-4-4l-.9.9" />
      <path d="M9.5 6.5a2.8 2.8 0 0 0-4 0L3.7 8.3a2.83 2.83 0 0 0 4 4l.9-.9" />
    </Svg>
  )
}

export function IconPlus(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M8 3v10M3 8h10" />
    </Svg>
  )
}

export function IconChevronDown(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M4 6l4 4 4-4" />
    </Svg>
  )
}

export function IconDisk(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <ellipse cx="8" cy="4" rx="6" ry="2.2" />
      <path d="M2 4v8c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2V4" />
      <path d="M2 8c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2" />
    </Svg>
  )
}

export function IconActivity(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M2 8h3l2-4 2.5 8 2-4H14" />
    </Svg>
  )
}

export function IconAlert(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4.8v3.7" />
      <path d="M8 11.2v.1" />
    </Svg>
  )
}

export function IconExternal(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M6.5 3.5H3.5v9h9V9.5" />
      <path d="M9 3.5h3.5V7" />
      <path d="M12.5 3.5 7 9" />
    </Svg>
  )
}

export function IconRetry(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.5 1.5v3h-3" />
    </Svg>
  )
}
