"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { SignInButton, UserButton, useUser } from "@/lib/dev-auth";
import { Button } from "@/components/ui/button";

export function Navbar() {
  const { isSignedIn, isLoaded } = useUser();

  return (
    <nav className="fixed top-0 w-full z-50 border-b border-white/5 bg-background/50 backdrop-blur-xl supports-[backdrop-filter]:bg-background/20">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
          <div className="bg-primary/20 p-1.5 rounded-lg border border-primary/30">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <span className="font-bold text-xl tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">
            HS Solutions
          </span>
        </Link>
        <div className="flex items-center gap-4">
          {isLoaded && !isSignedIn && (
            <>
              <SignInButton mode="modal">
                <Button variant="ghost" className="text-muted-foreground hover:text-white transition-colors">
                  Sign In
                </Button>
              </SignInButton>
              <Link href="/sign-up">
                <Button className="bg-white text-black hover:bg-white/90 font-medium">
                  Get Started
                </Button>
              </Link>
            </>
          )}
          {isLoaded && isSignedIn && (
            <>
              <Link href="/dashboard">
                <Button className="bg-primary/20 hover:bg-primary/30 text-primary border border-primary/50 transition-all font-medium">
                  Dashboard
                </Button>
              </Link>
              <UserButton />
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
