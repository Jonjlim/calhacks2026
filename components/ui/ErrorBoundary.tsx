"use client";

import { Component, type ReactNode } from "react";

/** Catches render-time throws (e.g. a malformed room ID rejected by Convex argument validation). */
export class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
