import { afterEach, describe, expect, test } from "bun:test";
import { getUpdateInfo, installKind, isNewerVersion } from "../modules/settings/update-check.js";

describe("update check", () => {
  afterEach(() => {
    delete process.env.AGENTHANDS_INSTALL;
    delete process.env.AGENTHANDS_UPDATE_REPO;
  });

  test("compares versions numerically", () => {
    expect(isNewerVersion("0.10.0", "0.9.9")).toBe(true);
    expect(isNewerVersion("v1.0.0", "0.4.2")).toBe(true);
    expect(isNewerVersion("0.4.2", "0.4.2")).toBe(false);
    expect(isNewerVersion("0.4.1", "0.4.2")).toBe(false);
    expect(isNewerVersion("garbage", "0.4.2")).toBe(false);
  });

  test("detects docker from the image env", () => {
    process.env.AGENTHANDS_INSTALL = "docker";
    expect(installKind()).toBe("docker");
  });

  test("never calls GitHub when running from source", async () => {
    const info = await getUpdateInfo();
    expect(info.install).toBe("source");
    expect(info.latest).toBeNull();
    expect(info.updateAvailable).toBe(false);
    expect(info.command).toBeNull();
  });

  test("an invalid repo turns the check off", async () => {
    process.env.AGENTHANDS_INSTALL = "docker";
    process.env.AGENTHANDS_UPDATE_REPO = "off";
    const info = await getUpdateInfo();
    expect(info.install).toBe("docker");
    expect(info.latest).toBeNull();
    expect(info.command).toBeNull();
  });
});
