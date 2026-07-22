import axios, { type AxiosInstance, isAxiosError } from "axios";
import { API_BASE_URL } from "./constants.js";
import { CliError } from "./logger.js";
import type { StoredCredentials } from "./credentials.js";

export interface DeviceAuthStart {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresInSeconds: number;
  pollIntervalSeconds: number;
}

export interface DeviceAuthResult {
  status: "pending" | "approved" | "expired";
  apiKey?: string;
  organizationId?: string;
  organizationSlug?: string;
  userEmail?: string;
}

export interface RemoteProject {
  id: string;
  slug: string;
  name: string;
}

export interface LinkRepositoryResponse {
  repositoryId: string;
  project: RemoteProject;
}

export interface ScanUploadResponse {
  testRunId: string;
  dashboardUrl: string;
  qualityGate?: { status: "PASSED" | "FAILED" | "WARNING"; reason: string };
  quota: { used: number; limit: number };
}

/**
 * Thin wrapper around the Cloud API. Every method maps 1:1 to an endpoint
 * documented in apps/api (Phase 5). This client has no knowledge of git,
 * Stryker, or the local filesystem — it only speaks HTTP + JSON.
 */
export class ApiClient {
  private readonly http: AxiosInstance;

  constructor(apiKey?: string) {
    this.http = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30_000,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    });
  }

  static forAuthenticatedUser(creds: StoredCredentials): ApiClient {
    return new ApiClient(creds.apiKey);
  }

  async startDeviceAuth(): Promise<DeviceAuthStart> {
    return this.request<DeviceAuthStart>("post", "/api/cli/auth/device");
  }

  async pollDeviceAuth(deviceCode: string): Promise<DeviceAuthResult> {
    return this.request<DeviceAuthResult>("post", "/api/cli/auth/device/poll", {
      deviceCode,
    });
  }

  async listProjects(): Promise<RemoteProject[]> {
    return this.request<RemoteProject[]>("get", "/api/cli/projects");
  }

  async linkRepository(params: {
    projectSlug: string;
    fullName: string;
    defaultBranch: string;
    provider: "GITHUB" | "GITLAB" | "BITBUCKET" | "MANUAL";
  }): Promise<LinkRepositoryResponse> {
    return this.request<LinkRepositoryResponse>("post", "/api/cli/repositories/link", params);
  }

  async uploadScanReport(params: {
    repositoryId: string;
    commitSha: string;
    branch: string;
    trigger: "CLI" | "GITHUB_PR" | "GITHUB_PUSH" | "MANUAL" | "SCHEDULED";
    pullRequestNumber?: number;
    score: unknown;
    mutants: unknown[];
    durationMs?: number;
  }): Promise<ScanUploadResponse> {
    return this.request<ScanUploadResponse>("post", "/api/cli/scans", params);
  }

  async whoami(): Promise<{
    userEmail: string;
    organizationSlug: string;
    organizationId: string;
    quota: { used: number; limit: number; resetsAt: string };
  }> {
    return this.request("get", "/api/cli/whoami");
  }

  private async request<T>(
    method: "get" | "post",
    url: string,
    data?: unknown,
  ): Promise<T> {
    try {
      const response = await this.http.request<T>({ method, url, data });
      return response.data;
    } catch (err) {
      throw toCliError(err);
    }
  }
}

function toCliError(err: unknown): CliError {
  if (isAxiosError(err)) {
    if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") {
      return new CliError(
        `Could not reach the AITG API at ${API_BASE_URL}.`,
        "Check your network connection, or AITG_API_URL if you're pointing at a local server.",
      );
    }

    const status = err.response?.status;
    const serverMessage =
      (err.response?.data as { message?: string } | undefined)?.message;

    if (status === 401) {
      return new CliError(
        "Your session has expired or is invalid.",
        "Run `aitg login` again.",
      );
    }

    if (status === 402) {
      return new CliError(
        serverMessage ?? "Monthly mutation quota exceeded.",
        "Upgrade your plan, or wait for the quota to reset next billing cycle.",
      );
    }

    if (status === 404) {
      return new CliError(serverMessage ?? "Resource not found.");
    }

    return new CliError(
      serverMessage ?? `Request failed with status ${status ?? "unknown"}.`,
    );
  }

  return new CliError(err instanceof Error ? err.message : String(err));
}
