import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = { title: "Food Delivery Demo", description: "DBMS course project" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><header><span className="brand">QuickBite</span><nav><a href="/">Customer</a> · <a href="/owner">Owner</a> · <a href="/partner">Delivery partner</a> · <a href="/admin">Admin</a></nav></header><main>{children}</main></body></html>;
}
