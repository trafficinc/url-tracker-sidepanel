# URL Tracker Side Panel

A Chrome extension that tracks URL changes across tabs in a **side panel** for debugging and testing.

It is useful for:

- tracing redirects
- watching SPA route changes
- seeing where a Chrome extension sends the browser
- debugging normal web application navigation
- capturing and reviewing visited URLs during a test session

## Features

- Start Capture / Stop Capture
- Track URL changes in any tab
- Detect regular navigation changes
- Detect SPA/history API URL changes
- Detect hash/fragment changes
- Side panel UI for easy review
- Search and filter collected events
- Delete individual events
- Delete selected events
- Clear all collected events
- Export captured events as JSON

## What it captures

This extension listens for browser navigation-related events and records URL changes such as:

- standard tab URL updates
- committed navigations
- history state updates
- fragment/hash updates

This makes it useful for both:

- **web application debugging**
- **Chrome extension testing**

If another extension changes the browser URL, this extension can usually detect and log it.

## Limitations

This extension only records URL changes that Chrome exposes through tab and navigation events.

It does **not** inspect another extension’s internal logic directly.

That means:

- if another extension changes the actual browser URL, it can be logged
- if another extension changes page behavior without changing the tab URL, there may be nothing to capture

## Use cases

- QA testing for browser extensions
- debugging login redirects
- tracking navigation across multiple tabs
- inspecting SPA route changes
- reproducing user navigation flows
- capturing a navigation trail during manual testing


Install steps:

1. Download the ZIP in releases
2. Extract it
3. Go to chrome://extensions
4. Enable Developer Mode
5. Click "Load Unpacked"
6. Select the folder
