export const metadata = {
  title: "AI Test Integrity Guard API",
  description: "Backend services for AI Test Integrity Guard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
