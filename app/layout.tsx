import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ProcureGuard AI | Procurement Fraud Detection',
  description:
    'Evidence-based procurement risk monitoring with explainable AI.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
