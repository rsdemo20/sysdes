/**
 * HTTP client for the sysdes API.
 *
 * The SPA and the API share one origin, so the session cookie is sent by the
 * browser and never touched here. Mutating calls carry the CSRF token that
 * `/auth/me` hands out; no token is stored anywhere a script on another origin
 * could read it.
 *
 * Failure mapping matters more than it looks. A response that says "no" is a
 * decision the coordinator can act on. A request that never produced a response
 * is an unknown outcome: the write may or may not have been stored, so it is
 * reported separately and settled by reading the canvas back.
 */
import {
  SaveHttpError,
  UnknownOutcomeError,
  type SaveResult,
  type Snapshot,
  type SolutionsTransport,
} from "./SaveCoordinator";
import type { CanvasDocument } from "../model/types";
import type {
  EvaluationBody,
  EvaluationSummary,
  EvaluationType,
  StartedEvaluation,
} from "../evaluation/types";

export interface PublicUser {
  id: string;
  login: string;
  /** What this account may do beyond its own canvases. */
  role: "user" | "admin";
}

export interface Session {
  user: PublicUser;
  passwordChangeRequired: boolean;
  csrfToken: string;
}

export interface SolutionBody {
  id: string;
  name: string;
  domainId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  currentReportRef: string | null;
  /** Hints taken on this canvas; each costs a later evaluation five points. */
  hintsUsed: number;
  document: CanvasDocument;
}

export interface SolutionSummary extends Omit<SolutionBody, "document"> {}

export type HintKind = "hld" | "er" | "sequence" | "notes";

/** What one press of the hint button opened, and what it has cost so far. */
export interface HintTaken {
  kind: HintKind;
  revealedCount: number;
  hintsUsed: number;
  penaltyPercent: number;
  /** Twenty hints take the whole score, and a solution run is then refused. */
  scoreExhausted: boolean;
  solution: SolutionBody;
}

export interface Domain {
  id: string;
  code: string;
  displayName: string;
}

export interface CatalogSummary {
  entryId: string;
  entryVersion: number;
  domainId: string;
  title: string;
  locale: string;
  origin: "starter" | "user";
  exportTag: string | null;
  stars: number;
  difficultyReserve: number;
  allowedDisclosureLevels: number[];
  gradable: boolean;
}

/** A card as the reader sees it: the statement, and whatever the level opens. */
export interface CatalogEntryBody {
  summary: CatalogSummary;
  disclosure: number;
  baseRequirements: string[];
  keyMetrics: string[];
  acceptanceCriteria: string[];
  revealedDocument: CanvasDocument | null;
}

/** The template as its author drew it, for reading rather than solving. */
export interface CatalogReferenceBody {
  summary: CatalogSummary;
  baseRequirements: string[];
  keyMetrics: string[];
  acceptanceCriteria: string[];
  document: CanvasDocument;
}

export interface Selection {
  currentSolutionId: string | null;
  selectionRevision: number;
}

/** A refused request. `code` is the stable machine code from the problem body. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    detail: string,
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

const BASE = "/api/v1";

export class SysdesApi implements SolutionsTransport {
  private csrfToken: string | null = null;

  private readonly fetchImpl: typeof fetch;

  // fetch must stay bound to the global object: calling a detached reference
  // throws "Illegal invocation" in the browser.
  constructor(fetchImpl?: typeof fetch) {
    this.fetchImpl = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  }

  private async request<T>(
    method: string,
    path: string,
    options: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<{ data: T; headers: Headers }> {
    const mutating = method !== "GET";
    const headers: Record<string, string> = { ...options.headers };
    if (options.body !== undefined)
      headers["Content-Type"] = "application/json";
    if (mutating && this.csrfToken) headers["X-CSRF-Token"] = this.csrfToken;

    const response = await this.fetchImpl(BASE + path, {
      method,
      headers,
      credentials: "same-origin",
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    if (!response.ok) {
      let code = `http_${response.status}`;
      let detail = response.statusText;
      try {
        const problem = await response.json();
        code = problem.code ?? code;
        detail = problem.detail ?? detail;
      } catch {
        // A body that is not a problem document must not mask the status.
      }
      throw new ApiError(response.status, code, detail);
    }
    const data =
      response.status === 204
        ? (undefined as T)
        : ((await response.json()) as T);
    return { data, headers: response.headers };
  }

  private remember(session: Session): Session {
    this.csrfToken = session.csrfToken;
    return session;
  }

  /** Returns null when there is no usable session, rather than throwing. */
  async currentSession(): Promise<Session | null> {
    try {
      const { data } = await this.request<Session>("GET", "/auth/me");
      return this.remember(data);
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 403)
      )
        return null;
      throw error;
    }
  }

  async register(login: string, password: string): Promise<Session> {
    await this.request<PublicUser>("POST", "/auth/register", {
      body: { login, password },
    });
    // Registration signs the user in; read the session for its CSRF token.
    const session = await this.currentSession();
    if (!session)
      throw new ApiError(500, "no_session", "Registration left no session.");
    return session;
  }

  async login(login: string, password: string): Promise<Session> {
    const { data } = await this.request<Session>("POST", "/auth/login", {
      body: { login, password },
    });
    return this.remember(data);
  }

  /**
   * Change the password of the signed-in account.
   *
   * The server rotates the session, so the answer carries a new CSRF token and
   * it is remembered here: without that the next mutating call would be refused
   * by a token the browser no longer holds.
   */
  async changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<Session> {
    const { data } = await this.request<Session>(
      "POST",
      "/auth/change-password",
      { body: { currentPassword, newPassword } },
    );
    return this.remember(data);
  }

  async logout(): Promise<void> {
    await this.request<void>("POST", "/auth/logout", { body: {} });
    this.csrfToken = null;
  }

  async listSolutions(): Promise<{
    items: SolutionSummary[];
    nextCursor: string | null;
    capacity: { used: number; limit: number };
  }> {
    const { data } = await this.request<{
      items: SolutionSummary[];
      nextCursor: string | null;
      capacity: { used: number; limit: number };
    }>("GET", "/solutions");
    return data;
  }

  async createSolution(
    domainId: string,
    name: string | null = null,
  ): Promise<SolutionBody> {
    const { data } = await this.request<SolutionBody>("POST", "/solutions", {
      body: { domainId, templateVersionRef: null, name },
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    return data;
  }

  async listDomains(locale: string = "ru"): Promise<Domain[]> {
    const { data } = await this.request<Domain[]>(
      "GET",
      `/domains?locale=${locale}`,
    );
    return data;
  }

  async listCatalog(
    filters: {
      domainId?: string;
      stars?: number;
      origin?: string;
      exportTag?: string;
      locale?: string;
      cursor?: string;
    } = {},
  ): Promise<{ items: CatalogSummary[]; nextCursor: string | null }> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters))
      if (value !== undefined && value !== "") query.set(key, String(value));
    const suffix = query.toString();
    const { data } = await this.request<{
      items: CatalogSummary[];
      nextCursor: string | null;
    }>("GET", `/catalog${suffix ? `?${suffix}` : ""}`);
    return data;
  }

  /** The statement of one card, plus the part of the schema the level opens. */
  async readCatalogEntry(
    entryId: string,
    entryVersion: number,
    disclosure: number,
    locale: string = "ru",
  ): Promise<CatalogEntryBody> {
    const { data } = await this.request<CatalogEntryBody>(
      "GET",
      `/catalog/${entryId}/versions/${entryVersion}?disclosure=${disclosure}&locale=${locale}`,
    );
    return data;
  }

  /** The whole published entry: a worked example to study, not a card to solve. */
  async readCatalogReference(
    entryId: string,
    entryVersion: number,
    locale: string = "ru",
  ): Promise<CatalogReferenceBody> {
    const { data } = await this.request<CatalogReferenceBody>(
      "GET",
      `/catalog/${entryId}/versions/${entryVersion}/reference?locale=${locale}`,
    );
    return data;
  }

  /**
   * Save a correction over a catalog template. Administrators only.
   *
   * This is the ordinary Save: the template keeps its identity and its version,
   * so the catalog goes on listing it once and the corrected drawing is what
   * anybody starting the task gets. The version in the path is the one that was
   * read, so an edit built on a stale read fails loudly instead of landing on
   * top of somebody else's. Anything the body omits keeps what the template had.
   */
  async saveCatalogTemplate(
    entryId: string,
    entryVersion: number,
    edit: { document?: CanvasDocument },
  ): Promise<CatalogSummary> {
    const { data } = await this.request<CatalogSummary>(
      "PUT",
      `/catalog/${entryId}/versions/${entryVersion}`,
      { body: edit },
    );
    return data;
  }

  /**
   * Save an edited template under a new name. Administrators only.
   *
   * Save as: the copy is a template of its own, starting at version 1, and the
   * one it came from is left exactly as it was -- which is how an administrator
   * keeps the original while trying something else.
   */
  async copyCatalogTemplate(
    entryId: string,
    copy: { title: string; baseVersion?: number; document?: CanvasDocument },
  ): Promise<CatalogSummary> {
    const { data } = await this.request<CatalogSummary>(
      "POST",
      `/catalog/${entryId}/copies`,
      { body: copy },
    );
    return data;
  }

  /** Create from a catalog card at the chosen disclosure level, or Custom when null. */
  async createFromCard(
    domainId: string,
    card: { entryId: string; entryVersion: number; disclosure: number } | null,
  ): Promise<SolutionBody> {
    const { data } = await this.request<SolutionBody>("POST", "/solutions", {
      body: {
        domainId,
        name: null,
        templateVersionRef: card
          ? { templateId: card.entryId, templateVersion: card.entryVersion }
          : null,
        disclosure: card ? card.disclosure : null,
      },
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    return data;
  }

  async getSolution(id: string): Promise<SolutionBody> {
    const { data } = await this.request<SolutionBody>(
      "GET",
      `/solutions/${id}`,
    );
    return data;
  }

  async getCurrentSolution(): Promise<Selection> {
    const { data } = await this.request<Selection>(
      "GET",
      "/me/current-solution",
    );
    return data;
  }

  async selectSolution(
    solutionId: string,
    selectionRevision: number,
  ): Promise<Selection> {
    const { data } = await this.request<Selection>(
      "PUT",
      "/me/current-solution",
      {
        body: { solutionId },
        headers: { "If-Match": `"${selectionRevision}"` },
      },
    );
    return data;
  }

  // ---- SolutionsTransport -------------------------------------------------

  async put(
    id: string,
    baseRevision: number,
    snapshot: Snapshot,
  ): Promise<SaveResult> {
    try {
      const { data } = await this.request<SolutionBody>(
        "PUT",
        `/solutions/${id}`,
        {
          body: { name: snapshot.name, document: snapshot.document },
          headers: { "If-Match": `"${baseRevision}"` },
        },
      );
      return { revision: data.revision };
    } catch (error) {
      if (error instanceof ApiError)
        throw new SaveHttpError(error.status, error.message);
      // No response at all: the write may still have been stored.
      throw new UnknownOutcomeError(String(error));
    }
  }

  /**
   * Open the next part of the template this canvas started from.
   *
   * Conditional on the revision, because it writes the document: a retry after
   * a lost response is refused rather than charged a second time.
   */
  async takeHint(id: string, revision: number): Promise<HintTaken> {
    const { data } = await this.request<HintTaken>("POST", `/solutions/${id}/hints`, {
      headers: { "If-Match": `"${revision}"` },
    });
    return data;
  }

  /** Permanent. The revision is required so a canvas edited elsewhere conflicts. */
  async deleteSolution(id: string, revision: number): Promise<void> {
    await this.request<void>("DELETE", `/solutions/${id}`, {
      headers: { "If-Match": `"${revision}"` },
    });
  }

  /**
   * Publish a finished canvas as a catalog entry.
   *
   * Eligibility is the server's to decide: it reads the stored report rather
   * than anything claimed here.
   */
  async publishToCatalog(
    id: string,
    body: {
      revision: number;
      exportTag: string | null;
      allowedDisclosureLevels: number[];
      difficultyReserve: number;
    },
  ): Promise<CatalogSummary> {
    const { data } = await this.request<CatalogSummary>(
      "POST",
      `/solutions/${id}/catalog-publications`,
      { body },
    );
    return data;
  }

  // ---- evaluation ---------------------------------------------------------

  /**
   * Ask for a run of one of the four commands.
   *
   * The revision is the one the coordinator confirmed, so the server evaluates
   * the version the user is looking at; a mismatch is refused as a conflict
   * rather than silently judging older work.
   */
  async startEvaluation(
    solutionId: string,
    body: {
      revision: number;
      evaluationType: EvaluationType;
      reportLocale: string;
      diagramIds: string[] | null;
    },
  ): Promise<StartedEvaluation> {
    const { data } = await this.request<StartedEvaluation>(
      "POST",
      `/solutions/${solutionId}/evaluations`,
      { body, headers: { "Idempotency-Key": crypto.randomUUID() } },
    );
    return data;
  }

  async getEvaluation(id: string): Promise<EvaluationBody> {
    const { data } = await this.request<EvaluationBody>(
      "GET",
      `/evaluations/${id}`,
    );
    return data;
  }

  /**
   * Run metadata, newest first. The entry with `resultAvailable` is the one
   * stored report of the canvas; the rest kept only their metadata.
   */
  async listEvaluations(
    solutionId: string,
    limit = 20,
  ): Promise<{ items: EvaluationSummary[]; nextCursor: string | null }> {
    const { data } = await this.request<{
      items: EvaluationSummary[];
      nextCursor: string | null;
    }>("GET", `/solutions/${solutionId}/evaluations?limit=${limit}`);
    return data;
  }

  async get(
    id: string,
  ): Promise<{ revision: number; name: string; document: CanvasDocument }> {
    const { data } = await this.request<SolutionBody>(
      "GET",
      `/solutions/${id}`,
    );
    return {
      revision: data.revision,
      name: data.name,
      document: data.document,
    };
  }
}
