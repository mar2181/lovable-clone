"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles, LayoutDashboard, Settings, CreditCard } from "lucide-react";
import { UserButton, useUser } from "@/lib/dev-auth";
import { cn } from "@/lib/utils";
import { CreditsDisplay } from "@/components/dashboard/credits-display";

const navItems = [
  { name: "Projects", href: "/dashboard", icon: LayoutDashboard },
  { name: "Billing", href: "/dashboard/billing", icon: CreditCard },
  { name: "Settings", href: "/dashboard/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user } = useUser();

  return (
    <div className="w-64 border-r border-white/5 bg-background/50 backdrop-blur-xl flex flex-col h-full">
      <div className="p-6">
        <Link href="/" className="flex items-center gap-2 mb-8 transition-opacity hover:opacity-80">
          <div className="bg-primary/20 p-1.5 rounded-lg border border-primary/30">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <span className="font-bold tracking-tight text-white">Lovable Clone</span>
        </Link>
        
        <nav className="space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  isActive 
                    ? "bg-white/10 text-white" 
                    : "text-muted-foreground hover:bg-white/5 hover:text-white"
                )}
              >
                <item.icon className="w-4 h-4" />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="mt-auto p-6 border-t border-white/5 space-y-6">
        <CreditsDisplay />
        <div className="flex items-center gap-3">
          <UserButton appearance={{
            elements: { avatarBox: "w-8 h-8 rounded-lg" }
          }} />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-white line-clamp-1">
              {user?.fullName || user?.primaryEmailAddress?.emailAddress || "User"}
            </span>
            <span className="text-xs text-muted-foreground">Free Plan</span>
          </div>
        </div>
      </div>
    </div>
  );
}
