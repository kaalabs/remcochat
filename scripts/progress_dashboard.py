#!/usr/bin/env python3
import curses
import os
import textwrap
import time
from dataclasses import dataclass

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - Python < 3.11
    import tomli as tomllib


REFRESH_SECONDS = 10
PROGRESS_PATH = "PROGRESS.toml"


@dataclass
class Event:
    ts: str
    type: str
    task: str
    raw: dict


def load_events(path: str) -> list[Event]:
    with open(path, "rb") as handle:
        data = tomllib.load(handle)
    events = []
    for item in data.get("events", []):
        ts = str(item.get("ts", ""))
        event_type = str(item.get("type", ""))
        task = item.get("task") or item.get("summary") or "(no task)"
        events.append(Event(ts=ts, type=event_type, task=str(task), raw=item))
    events.sort(key=lambda ev: ev.ts, reverse=True)
    return events


def clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


def clip(text: str, width: int) -> str:
    if width <= 0:
        return ""
    if len(text) <= width:
        return text
    if width <= 1:
        return text[:width]
    return text[: width - 1] + "…"


def format_field_value(value) -> list[str]:
    if isinstance(value, list):
        lines = []
        for item in value:
            for wrapped in textwrap.wrap(str(item), width=76):
                prefix = "- " if not lines or lines[-1].startswith("- ") else "  "
                lines.append(prefix + wrapped)
        return lines or ["- (empty)"]
    if isinstance(value, dict):
        lines = []
        for key, val in value.items():
            lines.append(f"{key}: {val}")
        return lines or ["(empty)"]
    if value is None:
        return ["(none)"]
    wrapped = textwrap.wrap(str(value), width=76) or [""]
    return wrapped


def render_list(
    stdscr,
    events: list[Event],
    selected: int,
    scroll_top: int,
    last_load: float,
    last_loaded_at: float | None,
    last_changed_at: float | None,
    last_status: str,
):
    height, width = stdscr.getmaxyx()
    if last_changed_at:
        changed_at = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(last_changed_at))
    else:
        changed_at = "never"
    header = (
        f"PROGRESS dashboard | {PROGRESS_PATH} | refresh {REFRESH_SECONDS}s | "
        f"last update {changed_at}"
    )
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    stdscr.addnstr(0, 0, header, width - 1)
    if last_loaded_at:
        last_loaded = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(last_loaded_at))
    else:
        last_loaded = "never"
    status_line = f"Now: {timestamp} | Last reload: {last_loaded} | Status: {last_status}"
    stdscr.addnstr(1, 0, status_line, width - 1)
    stdscr.hline(2, 0, "-", width)
    visible_rows = max(1, height - 4)

    ts_width = 20
    type_width = 10
    task_width = max(1, width - ts_width - type_width - 4)
    start = scroll_top
    end = min(len(events), scroll_top + visible_rows)
    for idx in range(start, end):
        row = 3 + (idx - start)
        event = events[idx]
        ts = clip(event.ts, ts_width)
        etype = clip(event.type, type_width)
        task = clip(event.task, task_width)
        line = f"{ts:<{ts_width}}  {etype:<{type_width}}  {task}"
        if idx == selected:
            stdscr.attron(curses.A_REVERSE)
            stdscr.addnstr(row, 0, line, width - 1)
            stdscr.attroff(curses.A_REVERSE)
        else:
            stdscr.addnstr(row, 0, line, width - 1)

    footer = "Up/Down: select  Enter: details  Esc: quit"
    stdscr.hline(height - 1, 0, "-", width)
    stdscr.addnstr(height - 1, 0, footer, width - 1)


def render_detail(stdscr, event: Event, scroll: int):
    height, width = stdscr.getmaxyx()
    title = f"Event detail | {event.ts} | {event.type}"
    stdscr.addnstr(0, 0, title, width - 1)
    stdscr.hline(1, 0, "-", width)

    lines: list[str] = []
    fields_order = ["task", "summary", "details", "challenges", "solutions", "decisions", "tests", "files"]
    used = set()
    for field in fields_order:
        if field in event.raw:
            used.add(field)
            lines.append(field.upper())
            for wrapped in format_field_value(event.raw[field]):
                for segment in textwrap.wrap(wrapped, width=width - 4):
                    lines.append(f"  {segment}")
            lines.append("")
    for field, value in event.raw.items():
        if field in used or field in ("ts", "type"):
            continue
        lines.append(field.upper())
        for wrapped in format_field_value(value):
            for segment in textwrap.wrap(wrapped, width=width - 4):
                lines.append(f"  {segment}")
        lines.append("")

    if not lines:
        lines = ["(no details)"]

    visible_rows = max(1, height - 3)
    scroll = clamp(scroll, 0, max(0, len(lines) - visible_rows))
    for i in range(visible_rows):
        idx = scroll + i
        if idx >= len(lines):
            break
        stdscr.addnstr(2 + i, 0, lines[idx], width - 1)

    footer = "Esc: back  Up/Down: scroll"
    stdscr.hline(height - 1, 0, "-", width)
    stdscr.addnstr(height - 1, 0, footer, width - 1)
    return scroll


def adjust_scroll(selected: int, scroll_top: int, visible_rows: int, total: int) -> int:
    if total <= visible_rows:
        return 0
    middle = visible_rows // 2
    max_scroll = max(0, total - visible_rows)
    if selected >= scroll_top + middle and scroll_top < max_scroll:
        scroll_top = clamp(selected - middle, 0, max_scroll)
    if selected < scroll_top + middle and scroll_top > 0:
        scroll_top = clamp(selected - middle, 0, max_scroll)
    if selected >= total - 1:
        scroll_top = max_scroll
    return scroll_top


def main(stdscr):
    curses.curs_set(0)
    stdscr.timeout(100)
    selected = 0
    scroll_top = 0
    detail_mode = False
    detail_scroll = 0
    last_load = 0.0
    last_loaded_at = None
    last_changed_at = None
    last_status = "waiting"
    events: list[Event] = []
    last_mtime = None

    while True:
        now = time.monotonic()
        if now - last_load >= REFRESH_SECONDS:
            try:
                mtime = os.path.getmtime(PROGRESS_PATH)
            except FileNotFoundError:
                mtime = None
            try:
                events = load_events(PROGRESS_PATH)
                last_loaded_at = time.time()
                if mtime != last_mtime:
                    last_status = "loaded"
                    last_changed_at = last_loaded_at
                else:
                    last_status = "loaded (unchanged)"
            except FileNotFoundError:
                events = []
                last_status = "not found"
            except Exception:
                events = []
                last_status = "load error"
            last_mtime = mtime
            selected = clamp(selected, 0, max(0, len(events) - 1))
            detail_scroll = 0
            last_load = now

        stdscr.erase()
        if detail_mode and events:
            detail_scroll = render_detail(stdscr, events[selected], detail_scroll)
        else:
            height, _ = stdscr.getmaxyx()
            visible_rows = max(1, height - 4)
            scroll_top = adjust_scroll(selected, scroll_top, visible_rows, len(events))
            render_list(
                stdscr,
                events,
                selected,
                scroll_top,
                last_load,
                last_loaded_at,
                last_changed_at,
                last_status,
            )
        stdscr.refresh()

        key = stdscr.getch()
        if key == -1:
            continue
        if detail_mode:
            if key in (27, ord("q")):
                detail_mode = False
                detail_scroll = 0
            elif key in (curses.KEY_UP, ord("k")):
                detail_scroll = max(0, detail_scroll - 1)
            elif key in (curses.KEY_DOWN, ord("j")):
                detail_scroll += 1
            continue

        if key in (27, ord("q")):
            break
        if key in (curses.KEY_UP, ord("k")):
            selected = max(0, selected - 1)
        elif key in (curses.KEY_DOWN, ord("j")):
            selected = min(max(0, len(events) - 1), selected + 1)
        elif key in (curses.KEY_ENTER, 10, 13):
            if events:
                detail_mode = True
                detail_scroll = 0


if __name__ == "__main__":
    curses.wrapper(main)
