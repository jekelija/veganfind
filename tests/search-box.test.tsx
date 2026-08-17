// @vitest-environment jsdom
/**
 * Component tests for the Photon search combobox: fetch is mocked, so these
 * cover the UI contract (debounce, keyboard interaction, a11y wiring,
 * result → MapFlyTarget mapping) without touching the network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/messages/en.json";
import SearchBox from "@/components/map/SearchBox";
import type { MapFlyTarget } from "@/components/map/types";

function photonResponse(features: unknown[]) {
  return {
    ok: true,
    json: async () => ({ features }),
  } as Response;
}

const CAPITOL_HILL = {
  geometry: { type: "Point", coordinates: [-122.3222, 47.6253] },
  properties: {
    name: "Capitol Hill",
    city: "Seattle",
    state: "Washington",
    extent: [-122.3327, 47.64, -122.3027, 47.6099], // photon order: w,n,e,s
  },
};

const PIKE_ST = {
  geometry: { type: "Point", coordinates: [-122.3266, 47.6141] },
  properties: {
    housenumber: "700",
    street: "Pike Street",
    city: "Seattle",
    state: "Washington",
  },
};

function renderSearchBox(onSelect: (t: MapFlyTarget) => void) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SearchBox onSelect={onSelect} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SearchBox", () => {
  it("shows suggestions and flies to a neighborhood's bounds on click", async () => {
    const fetchMock = vi.fn().mockResolvedValue(photonResponse([CAPITOL_HILL]));
    vi.stubGlobal("fetch", fetchMock);
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderSearchBox(onSelect);

    const input = screen.getByRole("combobox");
    await user.type(input, "capitol hill");

    const option = await screen.findByRole("option", {
      name: /Capitol Hill/,
    });
    expect(option).toBeInTheDocument();

    // Bias params point at the launch region.
    const url = String(fetchMock.mock.calls.at(-1)?.[0]);
    expect(url).toContain("photon.komoot.io");
    expect(url).toContain("lat=");
    expect(url).toContain("lon=");

    await user.click(option);
    expect(onSelect).toHaveBeenCalledTimes(1);
    const target = onSelect.mock.calls[0][0] as MapFlyTarget;
    // Photon extent [w,n,e,s] must arrive as MapLibre [w,s,e,n].
    expect(target).toEqual({
      kind: "bounds",
      bounds: [-122.3327, 47.6099, -122.3027, 47.64],
    });
    // Listbox closes after selection.
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("supports keyboard: arrows move the active option, Enter selects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(photonResponse([CAPITOL_HILL, PIKE_ST])),
    );
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderSearchBox(onSelect);

    const input = screen.getByRole("combobox");
    await user.type(input, "pike");
    await screen.findByRole("listbox");

    await user.keyboard("{ArrowDown}{ArrowDown}");
    const second = screen.getByRole("option", { name: /700 Pike Street/ });
    expect(second).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      second.getAttribute("id"),
    );

    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
    const target = onSelect.mock.calls[0][0] as MapFlyTarget;
    // No extent on an address → point target with the default zoom.
    expect(target).toMatchObject({
      kind: "point",
      lng: -122.3266,
      lat: 47.6141,
    });
  });

  it("Escape closes the listbox without selecting", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(photonResponse([CAPITOL_HILL])),
    );
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderSearchBox(onSelect);

    await user.type(screen.getByRole("combobox"), "capitol");
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders empty and error states", async () => {
    const fetchMock = vi.fn().mockResolvedValue(photonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderSearchBox(vi.fn());

    const input = screen.getByRole("combobox");
    await user.type(input, "zzzzz");
    expect(await screen.findByText('No results for "zzzzz"')).toBeVisible();

    fetchMock.mockRejectedValue(new TypeError("network down"));
    await user.clear(input);
    await user.type(input, "seattle");
    expect(
      await screen.findByText("Search failed — please try again."),
    ).toBeVisible();
  });

  it("dedupes results with identical labels", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          photonResponse([CAPITOL_HILL, CAPITOL_HILL, PIKE_ST]),
        ),
    );
    const user = userEvent.setup();
    renderSearchBox(vi.fn());

    await user.type(screen.getByRole("combobox"), "capitol");
    await screen.findByRole("listbox");
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("does not query for a single character", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderSearchBox(vi.fn());

    await user.type(screen.getByRole("combobox"), "a");
    // Debounce is 300ms — give it time to (not) fire.
    await new Promise((r) => setTimeout(r, 450));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
