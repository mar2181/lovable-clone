"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  ClerkProvider as RealClerkProvider,
  SignInButton as RealSignInButton,
  UserButton as RealUserButton,
  useAuth as realUseAuth,
  useUser as realUseUser,
} from "@clerk/nextjs";

const DEV_BYPASS = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "1" || process.env.NODE_ENV === "development";
const DEV_TOKEN = process.env.NEXT_PUBLIC_DEV_AUTH_TOKEN || "dev-local-user";
const DEV_EMAIL = "hssolutions2181@gmail.com";
const DEV_NAME = "Mario Elizondo";

function DevProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function RealProvider({ children }: { children: ReactNode }) {
  return <RealClerkProvider>{children}</RealClerkProvider>;
}

export const ClerkProvider = DEV_BYPASS ? DevProvider : RealProvider;

function useDevAuth() {
  return {
    getToken: async () => DEV_TOKEN,
    isLoaded: true,
    isSignedIn: true,
    userId: DEV_TOKEN,
    sessionId: "dev-session",
  };
}

function useRealAuth() {
  return realUseAuth();
}

export const useAuth = DEV_BYPASS ? useDevAuth : useRealAuth;

function useDevUser() {
  return {
    isLoaded: true,
    isSignedIn: true,
    user: {
      id: DEV_TOKEN,
      fullName: DEV_NAME,
      firstName: "Local",
      lastName: "Dev",
      primaryEmailAddress: {
        emailAddress: DEV_EMAIL,
      },
    },
  };
}

function useRealUser() {
  return realUseUser();
}

export const useUser = DEV_BYPASS ? useDevUser : useRealUser;

export function SignInButton({ children, ...props }: any) {
  if (DEV_BYPASS) {
    return (
      <Link href="/dashboard" className="contents">
        {children}
      </Link>
    );
  }

  return <RealSignInButton {...props}>{children}</RealSignInButton>;
}

export function UserButton(props: any) {
  if (DEV_BYPASS) {
    return (
      <div
        className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/30 text-primary flex items-center justify-center text-xs font-semibold"
        title={DEV_EMAIL}
      >
        LD
      </div>
    );
  }

  return <RealUserButton {...props} />;
}
