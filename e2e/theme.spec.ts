import { expect, test } from "@playwright/test";

function isPureWhite(color: string): boolean {
  if (color.trim().toLowerCase() === "transparent") return false;

  const rgb = color.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+\s*)?\)$/
  );
  if (rgb) {
    return (
      Number(rgb[1]) === 255 &&
      Number(rgb[2]) === 255 &&
      Number(rgb[3]) === 255
    );
  }

  const srgb = color.match(
    /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.]+\s*)?\)$/
  );
  if (srgb) {
    return (
      Number(srgb[1]) === 1 &&
      Number(srgb[2]) === 1 &&
      Number(srgb[3]) === 1
    );
  }

  const lab = color.match(
    /^lab\(\s*([\d.]+)%?\s+([-\d.]+)\s+([-\d.]+)(?:\s*\/\s*[\d.]+%?\s*)?\)$/
  );
  if (lab) {
    const L = Number(lab[1]);
    const a = Number(lab[2]);
    const b = Number(lab[3]);
    return L >= 99.99 && Math.abs(a) < 1e-6 && Math.abs(b) < 1e-6;
  }

  throw new Error(`Unsupported color format: ${color}`);
}

function isTransparent(color: string): boolean {
  const trimmed = color.trim().toLowerCase();
  if (trimmed === "transparent") return true;
  const rgba = trimmed.match(
    /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)$/
  );
  if (rgba) return Number(rgba[1]) === 0;
  const lab = trimmed.match(/^lab\([^)]*\/\s*([\d.]+)%?\s*\)$/);
  if (lab) return Number(lab[1]) === 0;
  return false;
}

test("Light theme background is not pure white (WebKit)", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");

  const isDark = await page.evaluate(() =>
    document.documentElement.classList.contains("dark")
  );
  expect(isDark).toBe(false);

  const bodyBg = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor
  );
  expect(isPureWhite(bodyBg)).toBe(false);

  const sidebarBg = await page.evaluate(() => {
    const aside = document.querySelector("aside");
    if (!aside) return "";
    return getComputedStyle(aside).backgroundColor;
  });
  expect(sidebarBg).not.toEqual("");
  expect(sidebarBg).not.toEqual(bodyBg);

  const composerBg = await page.evaluate(() => {
    const textarea = document.querySelector(
      '[data-testid="composer:textarea"]'
    ) as HTMLTextAreaElement | null;
    if (!textarea) return "";
    const form = textarea.form;
    if (!form) return "";
    return getComputedStyle(form).backgroundColor;
  });
  expect(composerBg).not.toEqual("");
  expect(isTransparent(composerBg)).toBe(false);
  expect(composerBg).toEqual(sidebarBg);

  const cardBg = await page.evaluate(() => {
    const el = document.createElement("div");
    el.style.backgroundColor = "var(--card)";
    document.body.appendChild(el);
    const value = getComputedStyle(el).backgroundColor;
    el.remove();
    return value;
  });
  expect(isPureWhite(cardBg)).toBe(false);

  const popoverBg = await page.evaluate(() => {
    const el = document.createElement("div");
    el.style.backgroundColor = "var(--popover)";
    document.body.appendChild(el);
    const value = getComputedStyle(el).backgroundColor;
    el.remove();
    return value;
  });
  expect(isPureWhite(popoverBg)).toBe(false);

  const bubbles = await page.evaluate(() => {
    const root = document.createElement("div");
    root.style.position = "absolute";
    root.style.left = "-99999px";
    root.style.top = "0";

    const mk = (containerClass: string, contentClass: string) => {
      const container = document.createElement("div");
      container.className = containerClass;
      const content = document.createElement("div");
      content.className = contentClass;
      content.textContent = "Bubble";
      container.appendChild(content);
      root.appendChild(container);
      return getComputedStyle(content).backgroundColor;
    };

    document.body.appendChild(root);
    const user = mk(
      "group is-user",
      "flex w-fit max-w-full min-w-0 flex-col gap-2 overflow-hidden text-sm group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:border group-[.is-user]:border-border group-[.is-user]:bg-message-user group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground group-[.is-user]:shadow-xs"
    );
    const assistant = mk(
      "group is-assistant",
      "flex w-fit max-w-full min-w-0 flex-col gap-2 overflow-hidden text-sm group-[.is-assistant]:rounded-lg group-[.is-assistant]:border group-[.is-assistant]:border-border group-[.is-assistant]:bg-message-assistant group-[.is-assistant]:px-4 group-[.is-assistant]:py-3 group-[.is-assistant]:text-foreground group-[.is-assistant]:shadow-xs"
    );
    root.remove();

    return { user, assistant };
  });

  expect(isTransparent(bubbles.user)).toBe(false);
  expect(isTransparent(bubbles.assistant)).toBe(false);
  expect(bubbles.user).not.toEqual(bodyBg);
  expect(bubbles.assistant).not.toEqual(bodyBg);
});
