interface Dispute {
  id: string;
  title: string;
  description: string;
  plaintiff: string;
  defendant: string;
  status: 'filed' | 'evidence' | 'mediation' | 'ruling' | 'appeal' | 'resolved';
  evidence: string[];
  rulings: Ruling[];
  precedentRefs: string[];
  createdAt: number;
  updatedAt: number;
}

interface Ruling {
  id: string;
  caseId: string;
  judge: string;
  decision: string;
  reasoning: string;
  penalty?: number;
  timestamp: number;
  appealed: boolean;
}

interface CaseResponse {
  cases: Dispute[];
  total: number;
  page: number;
}

const KV_NAMESPACE = 'FLEET_COURT';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
};

const htmlHeaders = {
  'Content-Type': 'text/html; charset=utf-8',
  ...securityHeaders,
  ...corsHeaders,
};

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  ...securityHeaders,
  ...corsHeaders,
};

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function validateDispute(data: any): string | null {
  if (!data.title || typeof data.title !== 'string' || data.title.length < 3) {
    return "Title must be at least 3 characters";
  }
  if (!data.description || typeof data.description !== 'string' || data.description.length < 10) {
    return "Description must be at least 10 characters";
  }
  if (!data.plaintiff || typeof data.plaintiff !== 'string' || data.plaintiff.length < 1) {
    return "Plaintiff is required";
  }
  if (!data.defendant || typeof data.defendant !== 'string' || data.defendant.length < 1) {
    return "Defendant is required";
  }
  return null;
}

function validateRuling(data: any): string | null {
  if (!data.caseId || typeof data.caseId !== 'string') {
    return "Case ID is required";
  }
  if (!data.judge || typeof data.judge !== 'string' || data.judge.length < 1) {
    return "Judge is required";
  }
  if (!data.decision || typeof data.decision !== 'string' || data.decision.length < 5) {
    return "Decision must be at least 5 characters";
  }
  if (!data.reasoning || typeof data.reasoning !== 'string' || data.reasoning.length < 10) {
    return "Reasoning must be at least 10 characters";
  }
  return null;
}

async function getKV(key: string): Promise<any> {
  try {
    const value = await FLEET_COURT.get(key, 'json');
    return value || null;
  } catch {
    return null;
  }
}

async function setKV(key: string, value: any): Promise<void> {
  await FLEET_COURT.put(key, JSON.stringify(value));
}

async function handlePostDispute(request: Request): Promise<Response> {
  try {
    const data = await request.json();
    const error = validateDispute(data);
    if (error) {
      return new Response(JSON.stringify({ error }), { status: 400, headers: jsonHeaders });
    }

    const dispute: Dispute = {
      id: generateId(),
      title: data.title.trim(),
      description: data.description.trim(),
      plaintiff: data.plaintiff.trim(),
      defendant: data.defendant.trim(),
      status: 'filed',
      evidence: [],
      rulings: [],
      precedentRefs: data.precedentRefs || [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await setKV(`dispute:${dispute.id}`, dispute);
    
    const cases = await getKV('cases:index') || [];
    cases.push(dispute.id);
    await setKV('cases:index', cases);

    return new Response(JSON.stringify({ 
      success: true, 
      id: dispute.id,
      message: "Dispute filed successfully" 
    }), { status: 201, headers: jsonHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: "Invalid request" }), { 
      status: 400, 
      headers: jsonHeaders 
    });
  }
}

async function handleGetCases(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const status = url.searchParams.get('status');
    const offset = (page - 1) * limit;

    const caseIds = await getKV('cases:index') || [];
    const allCases: Dispute[] = [];

    for (const id of caseIds) {
      const dispute = await getKV(`dispute:${id}`);
      if (dispute && (!status || dispute.status === status)) {
        allCases.push(dispute);
      }
    }

    allCases.sort((a, b) => b.createdAt - a.createdAt);
    
    const paginatedCases = allCases.slice(offset, offset + limit);
    
    const response: CaseResponse = {
      cases: paginatedCases,
      total: allCases.length,
      page,
    };

    return new Response(JSON.stringify(response), { headers: jsonHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: "Failed to retrieve cases" }), { 
      status: 500, 
      headers: jsonHeaders 
    });
  }
}

async function handlePostRuling(request: Request): Promise<Response> {
  try {
    const data = await request.json();
    const error = validateRuling(data);
    if (error) {
      return new Response(JSON.stringify({ error }), { status: 400, headers: jsonHeaders });
    }

    const dispute = await getKV(`dispute:${data.caseId}`);
    if (!dispute) {
      return new Response(JSON.stringify({ error: "Case not found" }), { 
        status: 404, 
        headers: jsonHeaders 
      });
    }

    if (dispute.status === 'resolved') {
      return new Response(JSON.stringify({ error: "Case already resolved" }), { 
        status: 400, 
        headers: jsonHeaders 
      });
    }

    const ruling: Ruling = {
      id: generateId(),
      caseId: data.caseId,
      judge: data.judge.trim(),
      decision: data.decision.trim(),
      reasoning: data.reasoning.trim(),
      penalty: data.penalty,
      timestamp: Date.now(),
      appealed: false,
    };

    dispute.rulings.push(ruling);
    dispute.status = dispute.status === 'filed' ? 'ruling' : dispute.status;
    dispute.updatedAt = Date.now();

    await setKV(`dispute:${data.caseId}`, dispute);
    await setKV(`ruling:${ruling.id}`, ruling);

    return new Response(JSON.stringify({ 
      success: true, 
      id: ruling.id,
      message: "Ruling recorded successfully" 
    }), { status: 201, headers: jsonHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: "Invalid request" }), { 
      status: 400, 
      headers: jsonHeaders 
    });
  }
}

function handleHealth(): Response {
  return new Response(JSON.stringify({ 
    status: "healthy", 
    service: "Fleet Court",
    timestamp: Date.now() 
  }), { headers: jsonHeaders });
}

function handleOptions(): Response {
  return new Response(null, {
    headers: corsHeaders,
  });
}

function renderDashboard(): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Fleet Court - Dispute Resolution</title>
    <style>
        :root {
            --dark-bg: #0a0a0f;
            --dark-card: #11111f;
            --accent: #f59e0b;
            --text: #e2e8f0;
            --text-secondary: #94a3b8;
            --success: #10b981;
            --warning: #f59e0b;
            --danger: #ef4444;
        }
        
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: var(--dark-bg);
            color: var(--text);
            line-height: 1.6;
            min-height: 100vh;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
        }
        
        header {
            text-align: center;
            margin-bottom: 3rem;
            padding-bottom: 2rem;
            border-bottom: 2px solid var(--accent);
        }
        
        h1 {
            font-size: 3rem;
            background: linear-gradient(135deg, var(--accent) 0%, #fbbf24 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 0.5rem;
        }
        
        .subtitle {
            color: var(--text-secondary);
            font-size: 1.2rem;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1.5rem;
            margin-bottom: 3rem;
        }
        
        .stat-card {
            background: var(--dark-card);
            padding: 1.5rem;
            border-radius: 12px;
            border-left: 4px solid var(--accent);
        }
        
        .stat-value {
            font-size: 2.5rem;
            font-weight: bold;
            color: var(--accent);
        }
        
        .stat-label {
            color: var(--text-secondary);
            font-size: 0.9rem;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 2rem;
            margin-bottom: 3rem;
        }
        
        .feature-card {
            background: var(--dark-card);
            padding: 2rem;
            border-radius: 12px;
            transition: transform 0.3s ease;
        }
        
        .feature-card:hover {
            transform: translateY(-5px);
        }
        
        .feature-icon {
            font-size: 2.5rem;
            margin-bottom: 1rem;
            color: var(--accent);
        }
        
        .feature-title {
            font-size: 1.3rem;
            margin-bottom: 1rem;
            color: var(--text);
        }
        
        .feature-desc {
            color: var(--text-secondary);
            font-size: 0.95rem;
        }
        
        .api-endpoints {
            background: var(--dark-card);
            padding: 2rem;
            border-radius: 12px;
            margin-bottom: 3rem;
        }
        
        .endpoint {
            display: flex;
            align-items: center;
            margin-bottom: 1rem;
            padding: 1rem;
            background: rgba(245, 158, 11, 0.1);
            border-radius: 8px;
        }
        
        .method {
            padding: 0.5rem 1rem;
            border-radius: 6px;
            font-weight: bold;
            margin-right: 1rem;
            min-width: 80px;
            text-align: center;
        }
        
        .method.post { background: var(--success); color: white; }
        .method.get { background: #3b82f6; color: white; }
        
        .path {
            font-family: 'Courier New', monospace;
            color: var(--accent);
        }
        
        .fleet-footer {
            text-align: center;
            padding: 2rem;
            color: var(--text-secondary);
            font-size: 0.9rem;
            border-top: 1px solid rgba(255,255,255,0.1);
            margin-top: 2rem;
        }
        
        @media (max-width: 768px) {
            .container { padding: 1rem; }
            h1 { font-size: 2rem; }
            .stats-grid { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>⚖️ Fleet Court</h1>
            <p class="subtitle">Decentralized Dispute Resolution & Governance Enforcement</p>
        </header>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value" id="casesCount">0</div>
                <div class="stat-label">Active Cases</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="resolvedCount">0</div>
                <div class="stat-label">Cases Resolved</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="appealsCount">0</div>
                <div class="stat-label">Appeals Filed</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="successRate">100%</div>
                <div class="stat-label">Resolution Rate</div>
            </div>
        </div>
        
        <div class="features">
            <div class="feature-card">
                <div class="feature-icon">📄</div>
                <h3 class="feature-title">Dispute Filing</h3>
                <p class="feature-desc">Submit disputes with detailed descriptions and involved parties for review.</p>
            </div>
            <div class="feature-card">
                <div class="feature-icon">🔍</div>
                <h3 class="feature-title">Evidence Collection</h3>
                <p class="feature-desc">Secure evidence submission and verification process for case evaluation.</p>
            </div>
            <div class="feature-card">
                <div class="feature-icon">🤝</div>
                <h3 class="feature-title">Mediation</h3>
                <p class="feature-desc">Facilitated negotiation between parties before formal ruling.</p>
            </div>
            <div class="feature-card">
                <div class="feature-icon">⚖️</div>
                <h3 class="feature-title">Ruling System</h3>
                <p class="feature-desc">Transparent decision-making process with detailed reasoning.</p>
            </div>
            <div class="feature-card">
                <div class="feature-icon">📚</div>
                <h3 class="feature-title">Precedent Tracking</h3>
                <p class="feature-desc">Historical case reference system for consistent rulings.</p>
            </div>
            <div class="feature-card">
                <div class="feature-icon">🔄</div>
                <h3 class="feature-title">Appeals Process</h3>
                <p class="feature-desc">Multi-level review system for contested decisions.</p>
            </div>
        </div>
        
        <div class="api-endpoints">
            <h2 style="margin-bottom: 1.5rem; color: var(--accent);">API Endpoints</h2>
            <div class="endpoint">
                <span class="method post">POST</span>
                <span class="path">/api/dispute</span>
            </div>
            <div class="endpoint">
                <span class="method get">GET</span>
                <span class="path">/api/cases</span>
            </div>
            <div class="endpoint">
                <span class="method post">POST</span>
                <span class="path">/api/ruling</span>
            </div>
            <div class="endpoint">
                <span class="method get">GET</span>
                <span class="path">/health</span>
            </div>
        </div>
        
        <div class="fleet-footer">
            <p>Fleet Court Governance System • Secure • Transparent • Decentralized</p>
            <p style="margin-top: 0.5rem; font-size: 0.8rem;">All rulings are final unless appealed through proper channels</p>
        </div>
    </div>
    
    <script>
        async function loadStats() {
            try {
                const response = await fetch('/api/cases?limit=1000');
                const data = await response.json();
                
                const active = data.cases.filter(c => c.status !== 'resolved').length;
                const resolved = data.cases.filter(c => c.status === 'resolved').length;
                const appeals = data.cases.filter(c => c.status === 'appeal').length;
                const rate = data.total > 0 ? Math.round((resolved / data.total) * 100) : 100;
                
                document.getElementById('casesCount').textContent = active;
                document.getElementById('resolvedCount').textContent = resolved;
                document.getElementById('appealsCount').textContent = appeals;
                document.getElementById('successRate').textContent = rate + '%';
            } catch (error) {
                console.error('Failed to load stats:', error);
            }
        }
        
        document.addEventListener('DOMContentLoaded', loadStats);
    </script>
</body>
</html>`;
}

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'OPTIONS') {
    return handleOptions();
  }

  if (path === '/' || path === '/dashboard') {
    return new Response(renderDashboard(), { headers: htmlHeaders });
  }

  if (path === '/health') {
    return handleHealth();
  }

  if (path === '/api/dispute' && request.method === 'POST') {
    return handlePostDispute(request);
  }

  if (path === '/api/cases' && request.method === 'GET') {
    return handleGetCases(request);
  }

  if (path === '/api/ruling' && request.method === 'POST') {
    return handlePostRuling(request);
  }

  return new Response(JSON.stringify({ error: "Not found" }), { 
    status: 404, 
    headers: jsonHeaders 
  });
}

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    (globalThis as any).FLEET_COURT = env.FLEET_COURT;
    return handleRequest(request);
  },
};