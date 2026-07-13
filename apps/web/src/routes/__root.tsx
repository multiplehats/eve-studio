import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router"

import appCss from "../styles.css?url"

const TITLE = "eve-studio: Watch your agent work"
const DESCRIPTION =
  "One command mounts a live observability workspace beside your eve agent, showing sessions, messages, tool calls, and usage, streamed to your browser."
const SITE_URL = "https://eve-studio-tau.vercel.app"
const SOCIAL_IMAGE = `${SITE_URL}/og-image.jpg`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { name: "theme-color", content: "#000000" },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "eve-studio" },
      { property: "og:url", content: SITE_URL },
      { property: "og:image", content: SOCIAL_IMAGE },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      {
        property: "og:image:alt",
        content: "Eve Studio showing a captured agent session",
      },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:creator", content: "@itschrisjayden" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
      { name: "twitter:image", content: SOCIAL_IMAGE },
      {
        name: "twitter:image:alt",
        content: "Eve Studio showing a captured agent session",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "canonical", href: SITE_URL },
    ],
  }),
  component: () => <Outlet />,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="bg-background text-foreground">
      <head>
        <HeadContent />
      </head>
      <body className="font-sans antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  )
}
