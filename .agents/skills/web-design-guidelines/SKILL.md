---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance. Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices".
metadata:
  author: vercel
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

# Web Interface Guidelines

Review files for compliance with Web Interface Guidelines.

## How It Works

1. Read the pinned guidelines from the local file below
2. Read the specified files (or prompt user for files/pattern)
3. Check against all rules in the guidelines
4. Output findings in the terse `file:line` format

## Guidelines Source

Read the rules from the local pinned copy bundled with this skill:

```
guidelines.md
```

This is a vendored snapshot of vercel-labs/web-interface-guidelines (command.md),
pinned locally to avoid fetching mutable remote instructions at review time.
Read it with the Read tool. Do NOT fetch the rules from the network.

To update the snapshot deliberately, re-download command.md from the upstream
repo, review the diff, and overwrite guidelines.md.

## Usage

When a user provides a file or pattern argument:
1. Read the pinned guidelines from `guidelines.md`
2. Read the specified files
3. Apply all rules from the guidelines
4. Output findings using the format specified in the guidelines

If no files specified, ask the user which files to review.
