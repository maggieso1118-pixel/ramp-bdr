import Link from "next/link";
import { Sprout } from "lucide-react";

export function BranchMark() { return <span className="branch-mark"><Sprout size={25} strokeWidth={1.6} aria-hidden="true" /></span>; }
export function Header() {
  return <header className="site-header"><Link href="/" className="identity" aria-label="BDR Agent Ramp home"><BranchMark /><span><strong>BDR Agent</strong> <span className="muted">/ Ramp</span></span></Link></header>;
}
export function Footer() {
  return <footer className="site-footer"><span>Independent prototype · Not affiliated with Ramp</span></footer>;
}
