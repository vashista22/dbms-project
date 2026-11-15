import type { Metadata } from "next";
import Link from "next/link";
import "./styles.css";

export const metadata: Metadata = {
  title: "QuickBite · Swiggy-Style Food Delivery DBMS",
  description: "CS F212 Database Management Systems Course Project",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header>
          <div className="brand-group">
            <Link href="/" className="brand">QuickBite</Link>
            <span className="brand-sub">PostgreSQL + Next.js DBMS Project</span>
          </div>
          <nav>
            <Link href="/">Customer</Link>
            <Link href="/owner">Restaurant Owner</Link>
            <Link href="/partner">Delivery Partner</Link>
            <Link href="/admin">Admin &amp; SQL Reports</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
