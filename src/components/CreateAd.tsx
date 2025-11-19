// src/components/CreateAd.tsx
import React from "react";
import { CONFIG } from "../config";
import { useAuth } from "../contexts";

type CampaignType = "cream" | "lotion";
type ImageSource = "ai" | "upload";

type AgentPermission = {
  id: number;
  monitoring: boolean;
  allows_action: boolean;
};

type SocialResult = {
  status: "success" | "error" | "skipped";
  reason?: string;
  error?: string;
  permalink?: string;
  post_id?: string;
  media_id?: string;
};

type PublishResult = {
  facebook?: SocialResult;
  instagram?: SocialResult;
};

const IMAGE_KEYS: Record<CampaignType, string> = {
  cream: "Spirulina Cream.jpg",
  lotion: "Spirulina Lotion.jpg",
};

const DEFAULT_PRODUCT_QUERY: Record<CampaignType, string> = {
  cream: "Foot cream for dry, cracked heels",
  lotion: "Everyday moisturizing spirulina body lotion",
};

const apiBase = (CONFIG.API_BASE || "").replace(/\/+$/, "");

export default function CreateAd() {
  const { token } = useAuth();

  const [campaignType, setCampaignType] = React.useState<CampaignType>("cream");
  const [imageSource, setImageSource] = React.useState<ImageSource>("ai");
  const [slogan, setSlogan] = React.useState("");
  const [hashtag, setHashtag] = React.useState("");
  const [customPrompt, setCustomPrompt] = React.useState(
    "Lifestyle shot on a bathroom counter with soft morning light"
  );
  const [loading, setLoading] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [publishResult, setPublishResult] =
    React.useState<PublishResult | null>(null);
  const [lastImageInfo, setLastImageInfo] = React.useState<{
    bucket: string;
    key: string;
  } | null>(null);

  const [uploadedFile, setUploadedFile] = React.useState<File | null>(null);
  const [uploadedPreview, setUploadedPreview] = React.useState<string | null>(
    null
  );

  const [permLoaded, setPermLoaded] = React.useState(false);
  const [monitoringAllowed, setMonitoringAllowed] = React.useState(false);

  const permissionEndpoint = React.useMemo(
    () => `${apiBase}/agent/permission?id=1`,
    []
  );

  const { fetchJSON, loadPermission } = usePermissionHelpers(
    token,
    permissionEndpoint,
    setMonitoringAllowed,
    setPermLoaded
  );

  // initial permission load
  React.useEffect(() => {
    const ctrl = new AbortController();
    loadPermission(ctrl.signal);
    return () => ctrl.abort();
  }, [loadPermission]);

  // react to global permission updates
  React.useEffect(() => {
    const onPermEvent = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (typeof d?.monitoring === "boolean") {
        setMonitoringAllowed(d.monitoring);
        setPermLoaded(true);
      }
    };
    window.addEventListener(
      "agent.permission.updated",
      onPermEvent as EventListener
    );
    return () =>
      window.removeEventListener(
        "agent.permission.updated",
        onPermEvent as EventListener
      );
  }, []);

  const isLoggedIn = Boolean(token);
  const canGenerateAI =
    isLoggedIn && monitoringAllowed && permLoaded && imageSource === "ai";

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setUploadedFile(null);
      if (uploadedPreview) URL.revokeObjectURL(uploadedPreview);
      setUploadedPreview(null);
      return;
    }
    setUploadedFile(file);
    if (uploadedPreview) URL.revokeObjectURL(uploadedPreview);
    const url = URL.createObjectURL(file);
    setUploadedPreview(url);
    setLastImageInfo(null);
  };

  const handleGenerate = async () => {
    if (!canGenerateAI) {
      setError(
        !isLoggedIn
          ? "You must be logged in to generate an AI image."
          : imageSource !== "ai"
          ? "Switch to 'Use AI-generated image' to generate an AI image."
          : "AI generation is currently disabled by admin."
      );
      return;
    }

    setLoading(true);
    setPublishing(false);
    setPublishResult(null);
    setError(null);

    const image_key = IMAGE_KEYS[campaignType];
    const product_query = DEFAULT_PRODUCT_QUERY[campaignType];

    try {
      const res = await fetch(`${apiBase}/marketing/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          image_key,
          product_query,
          custom_prompt: customPrompt,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      const data = await res.json();

      if (data.slogan) setSlogan(data.slogan);
      if (data.hashtag) setHashtag(data.hashtag);

      if (data.output_bucket && data.output_key) {
        setLastImageInfo({
          bucket: data.output_bucket,
          key: data.output_key,
        });
        if (uploadedPreview) URL.revokeObjectURL(uploadedPreview);
        setUploadedPreview(null);
        setUploadedFile(null);
      }
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Failed to generate ad");
    } finally {
      setLoading(false);
    }
  };

  // ---- Publish to Facebook & Instagram (/ad Lambda) ----
  const canPublish = isLoggedIn && !!lastImageInfo && !!slogan && !publishing;

  const handlePublish = async () => {
    if (!canPublish || !lastImageInfo) return;

    setPublishing(true);
    setError(null);
    setPublishResult(null);

    const trimmedHashtag = hashtag.trim();
    const caption = (slogan + " " + trimmedHashtag).trim();

    try {
      const data = await fetchJSON(
        `${apiBase}/ad`,
        {
          method: "POST",
          body: JSON.stringify({
            slogan: caption,
            image_bucket: lastImageInfo.bucket,
            image_key: lastImageInfo.key,
          }),
        },
        true
      );

      setPublishResult(data as PublishResult);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Failed to post to social media");
    } finally {
      setPublishing(false);
    }
  };

  const aiImageUrl =
    lastImageInfo &&
    `https://${lastImageInfo.bucket}.s3.amazonaws.com/${lastImageInfo.key}`;

  const showUploadedPreview =
    imageSource === "upload" && uploadedPreview !== null;
  const showAIPreview = imageSource === "ai" && aiImageUrl;

  const fbResult = publishResult?.facebook;
  const igResult = publishResult?.instagram;

  return (
    <div className="bg-white shadow rounded-xl p-6 space-y-4">
      <h2 className="text-xl font-semibold mb-2">Create Social Media Post</h2>

      {/* Campaign type selector */}
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">
          Generate Post for
        </label>
        <select
          value={campaignType}
          onChange={(e) => setCampaignType(e.target.value as CampaignType)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
        >
          <option value="cream">Spirulina Cream</option>
          <option value="lotion">Spirulina Lotion</option>
        </select>
      </div>

      {/* Image source choice */}
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">
          Image source
        </label>
        <div className="mt-1 flex flex-col gap-1 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="imageSource"
              value="ai"
              checked={imageSource === "ai"}
              onChange={() => setImageSource("ai")}
            />
            <span>Use AI-generated image</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="imageSource"
              value="upload"
              checked={imageSource === "upload"}
              onChange={() => setImageSource("upload")}
            />
            <span>Upload my own image</span>
          </label>
        </div>
      </div>

      {/* Custom prompt for AI image styling (only for AI mode) */}
      {imageSource === "ai" && (
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700">
            Image style prompt (optional)
          </label>
          <input
            type="text"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
            placeholder="Describe how the ad image should look"
          />
        </div>
      )}

      {/* Upload field (only for upload mode) */}
      {imageSource === "upload" && (
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700">
            Upload image
          </label>
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="mt-1 block w-full text-sm"
          />
          <p className="text-xs text-gray-500">
            This image will be used for the ad. AI image generation is disabled
            while &quot;Upload my own image&quot; is selected.
          </p>
        </div>
      )}

      {/* Slogan field */}
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">
          Post Description
        </label>
        <textarea
          value={slogan}
          onChange={(e) => setSlogan(e.target.value)}
          rows={2}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
          placeholder="Type your own post description, or click Generate to fill this with AI"
        />
      </div>

      {/* Hashtag field */}
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">
          Hashtag
        </label>
        <input
          type="text"
          value={hashtag}
          onChange={(e) => setHashtag(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
          placeholder="Type your own hashtag (e.g. #SkinCare) or let AI suggest one"
        />
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading || !canGenerateAI}
          className={`inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-white ${
            loading || !canGenerateAI
              ? "bg-gray-400 cursor-not-allowed"
              : "bg-sky-600 hover:bg-sky-700"
          }`}
        >
          {loading ? "Generating…" : "Generate AI image, slogan & hashtag"}
        </button>

        <button
          type="button"
          onClick={handlePublish}
          disabled={!canPublish}
          className={`inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-white ${
            !canPublish
              ? "bg-gray-400 cursor-not-allowed"
              : "bg-emerald-600 hover:bg-emerald-700"
          }`}
        >
          {publishing ? "Posting…" : "Post to Facebook & Instagram"}
        </button>

        {!isLoggedIn && (
          <span className="text-xs text-red-500">
            Please log in to use AI generation and posting.
          </span>
        )}
        {isLoggedIn &&
          imageSource === "ai" &&
          !monitoringAllowed &&
          permLoaded && (
            <span className="text-xs text-gray-500">
              AI generation is currently disabled by admin.
            </span>
          )}
        {imageSource === "upload" && (
          <span className="text-xs text-gray-500">
            Using uploaded image. Switch back to &quot;Use AI-generated
            image&quot; to generate a new visual and post it automatically.
          </span>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* Simple social status display */}
      {publishResult && (
        <div className="space-y-2 text-sm">
          {/* Facebook */}
          {fbResult && (
            <div
              className={`px-3 py-2 rounded-md border ${
                fbResult.status === "success"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                  : fbResult.status === "error"
                  ? "bg-red-50 border-red-200 text-red-700"
                  : "bg-gray-50 border-gray-200 text-gray-700"
              }`}
            >
              {fbResult.status === "success" &&
                "Posted to Facebook successfully."}
              {fbResult.status === "error" && "Failed to post to Facebook."}
              {fbResult.status === "skipped" &&
                "Skipped posting to Facebook (configuration not set)."}
            </div>
          )}

          {/* Instagram */}
          {igResult && (
            <div
              className={`px-3 py-2 rounded-md border ${
                igResult.status === "success"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                  : igResult.status === "error"
                  ? "bg-red-50 border-red-200 text-red-700"
                  : "bg-gray-50 border-gray-200 text-gray-700"
              }`}
            >
              {igResult.status === "success" &&
                "Posted to Instagram successfully."}
              {igResult.status === "error" && "Failed to post to Instagram."}
              {igResult.status === "skipped" &&
                "Skipped posting to Instagram (configuration not set)."}
            </div>
          )}
        </div>
      )}

      {/* Image preview */}
      {(showUploadedPreview || showAIPreview) && (
        <div className="mt-3 space-y-1">
          <div className="text-xs text-gray-500 mb-1">Image preview:</div>
          {showUploadedPreview && uploadedPreview && (
            <img
              src={uploadedPreview}
              alt="Uploaded ad preview"
              className="max-h-64 rounded-lg border border-gray-200"
            />
          )}
          {showAIPreview && aiImageUrl && (
            <img
              src={aiImageUrl}
              alt="Generated ad preview"
              className="max-h-64 rounded-lg border border-gray-200"
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Tiny helper hook to keep the top component readable
 */
function usePermissionHelpers(
  token: string | null,
  permissionEndpoint: string,
  setMonitoringAllowed: (v: boolean) => void,
  setPermLoaded: (v: boolean) => void
) {
  const fetchJSON = React.useCallback(
    async (
      url: string,
      init: RequestInit = {},
      withAuth = false,
      signal?: AbortSignal
    ) => {
      const headers: Record<string, string> = {
        Accept: "application/json",
        ...(init.headers as Record<string, string> | undefined),
      };
      if (withAuth && token) headers.Authorization = `Bearer ${token}`;
      if (init.body && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }

      const resp = await fetch(url, { ...init, headers, signal });
      const text = await resp.text();
      const data = text ? JSON.parse(text) : {};
      if (resp.status === 401 || resp.status === 403) {
        throw new Error("Unauthorized.");
      }
      if (!resp.ok) {
        throw new Error(data?.error || `HTTP ${resp.status}`);
      }
      return data;
    },
    [token]
  );

  const parsePermission = React.useCallback((r: any) => {
    const raw =
      (r && r.item) ??
      (Array.isArray(r?.items)
        ? r.items.find((x: any) => Number(x?.id) === 1) ?? r.items[0]
        : undefined) ??
      r;
    if (!raw || typeof raw !== "object") return null;
    return {
      id: Number(raw.id ?? 1),
      monitoring: Boolean(raw.monitoring),
      allows_action: Boolean(raw.allows_action),
    } as AgentPermission;
  }, []);

  const loadPermission = React.useCallback(
    async (signal?: AbortSignal) => {
      try {
        const r = await fetchJSON(
          permissionEndpoint,
          { method: "GET" },
          true,
          signal
        );
        const perm = parsePermission(r);
        setMonitoringAllowed(Boolean(perm?.monitoring));
      } catch {
        setMonitoringAllowed(false);
      } finally {
        setPermLoaded(true);
      }
    },
    [
      fetchJSON,
      parsePermission,
      permissionEndpoint,
      setMonitoringAllowed,
      setPermLoaded,
    ]
  );

  return { fetchJSON, loadPermission };
}
