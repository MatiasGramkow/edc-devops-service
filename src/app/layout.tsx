import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EDC DevOps Service",
  description: "Azure DevOps dashboard for edc-group",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="da" data-theme="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const t = localStorage.getItem('theme');
                if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
              } catch {}
            `,
          }}
        />
      </head>
      <body className="min-h-screen bg-bg-primary text-text-primary antialiased">
        {children}
      </body>
    </html>
  );
}
