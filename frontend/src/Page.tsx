import { ReactNode } from "react";

export default function Page({ children }: { children: ReactNode }) {
  return <main className="page">{children}</main>;
}
