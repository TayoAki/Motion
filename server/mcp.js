import { appURL } from "./providers.js";

export function installMCP({
  app,
  auth,
  db,
  find,
  createProject,
  enqueueRender,
  cancelProject,
}) {
  const idSchema = {
    type: "object",
    properties: { id: { type: "string", description: "Project ID" } },
    required: ["id"],
    additionalProperties: false,
  };
  const tools = [
    {
      name: "project_list",
      description: "List projects in the authenticated workspace.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "project_get",
      description: "Read project status and editable scene settings.",
      inputSchema: idSchema,
      annotations: { readOnlyHint: true },
    },
    {
      name: "project_create",
      description:
        "Save a video draft. Rendering is a separate credit-consuming action.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          script: { type: "string", minLength: 10, maxLength: 8000 },
          voice: { enum: ["slt", "rms", "awb", "kal"] },
          background: {
            enum: ["mountains", "ocean", "forest", "space", "night", "minimal"],
          },
          aspect: { enum: ["16:9", "9:16"] },
          captions: { type: "boolean" },
          graphics: { type: "boolean" },
          music: { type: "boolean" },
        },
        required: ["script"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "project_render",
      description:
        "Reserve generation credits and render a draft, or re-export an edited project. Charges credits.",
      inputSchema: idSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    {
      name: "project_cancel",
      description: "Cancel an active render and return its reserved credits.",
      inputSchema: idSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "project_export",
      description:
        "Get an authenticated MP4 URL and the editable manifest for an exported project. The URL requires the same bearer key.",
      inputSchema: idSchema,
      annotations: { readOnlyHint: true },
    },
    {
      name: "credits_get",
      description: "Read the current balance and credit transactions.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
  ];
  app.get("/api/mcp", auth, (_req, res) =>
    res
      .set("Allow", "POST")
      .status(405)
      .json({ error: "Use POST for stateless MCP JSON-RPC requests." }),
  );
  app.post("/api/mcp", auth, async (req, res) => {
    const message = req.body,
      id = message?.id ?? null;
    const error = (code, text) =>
      res.json({ jsonrpc: "2.0", id, error: { code, message: text } });
    if (
      !message ||
      Array.isArray(message) ||
      message.jsonrpc !== "2.0" ||
      typeof message.method !== "string" ||
      ("id" in message && !["string", "number"].includes(typeof message.id))
    )
      return error(-32600, "Invalid JSON-RPC request.");
    if (!("id" in message)) return res.status(202).end();
    const reply = (result) => res.json({ jsonrpc: "2.0", id, result });
    if (message.method === "initialize")
      return reply({
        protocolVersion: ["2025-03-26", "2025-06-18", "2025-11-25"].includes(
          message.params?.protocolVersion,
        )
          ? message.params.protocolVersion
          : "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "motion-studio", version: "1.1.0" },
        instructions:
          "Each request requires a workspace API key in Authorization: Bearer. Rendering consumes credits. Export links require the same authorization.",
      });
    if (message.method === "ping") return reply({});
    if (message.method === "tools/list") return reply({ tools });
    if (message.method !== "tools/call")
      return error(-32601, "Method not found.");
    const tool = tools.find((t) => t.name === message.params?.name);
    if (!tool) return error(-32602, "Unknown tool.");
    const args = message.params?.arguments || {};
    if (
      typeof args !== "object" ||
      Array.isArray(args) ||
      Object.keys(args).some(
        (k) => !Object.hasOwn(tool.inputSchema.properties, k),
      ) ||
      tool.inputSchema.required?.some((k) => typeof args[k] !== "string")
    )
      return error(-32602, "Invalid tool arguments.");
    const uid = req.user.id;
    try {
      let result;
      if (tool.name === "project_list")
        result = db
          .prepare(
            "SELECT data FROM projects WHERE user_id=? ORDER BY rowid DESC",
          )
          .all(uid)
          .map((r) => JSON.parse(r.data));
      else if (tool.name === "project_create")
        result = createProject(uid, args);
      else if (tool.name === "project_render")
        result = enqueueRender(uid, args.id);
      else if (tool.name === "project_cancel")
        result = cancelProject(uid, args.id);
      else if (tool.name === "credits_get")
        result = {
          credits: db.prepare("SELECT credits FROM users WHERE id=?").get(uid)
            .credits,
          history: db
            .prepare(
              "SELECT label,amount,created FROM ledger WHERE user_id=? ORDER BY rowid DESC LIMIT 100",
            )
            .all(uid),
        };
      else {
        const p = find(args.id, uid);
        if (!p) throw new Error("Project not found.");
        if (tool.name === "project_export") {
          if (!p.file)
            throw new Error("Render this project before downloading.");
          result = {
            downloadURL: `${appURL()}/api/projects/${encodeURIComponent(p.id)}/download`,
            requiresAuthorization: true,
            manifest: p,
          };
        } else result = p;
      }
      reply({ content: [{ type: "text", text: JSON.stringify(result) }] });
    } catch (e) {
      reply({ isError: true, content: [{ type: "text", text: e.message }] });
    }
  });
}
