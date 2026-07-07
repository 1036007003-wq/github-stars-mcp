#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const USER_AGENT = 'GitHubStarsMCP/1.0.0 (https://github.com/1036007003-wq/github-stars-mcp)';
const GITHUB_API = 'https://api.github.com';

// --- GitHub API helpers ---

async function githubApi(path, token) {
  const url = `${GITHUB_API}${path}`;
  const headers = { 'User-Agent': USER_AGENT, 'Accept': 'application/vnd.github.v3+json' };
  if (token) headers['Authorization'] = `token ${token}`;
  const res = await fetch(url, { headers, timeout: 15000 });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  return res.json();
}

async function githubApiPaginated(path, token, maxPages = 5) {
  let results = [];
  let page = 1;
  while (page <= maxPages) {
    const data = await githubApi(`${path}?page=${page}&per_page=100`, token);
    if (!Array.isArray(data) || data.length === 0) break;
    results = results.concat(data);
    page++;
  }
  return results;
}

function isPremium() {
  const licenseKey = process.env.LICENSE_KEY;
  if (!licenseKey) return false;
  return licenseKey.length > 10;
}

// --- AI README optimization via DeepSeek ---

async function aiOptimizeReadme(repoName, currentReadme, competitors) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return `[Premium] Set DEEPSEEK_API_KEY in .env to enable AI optimization.
    
Current README length: ${currentReadme?.length || 0} chars.
Competitors to learn from: ${competitors || 'none'}

Tips to improve your README:
1. Add a clear "Why this repo?" section
2. Add screenshots/GIFs
3. Add "Quick Start" with code examples
4. Add badges (build passing, npm version, etc.)
5. Add a "Sponsor" button (FUNDING.yml)

Upgrade to premium for AI-powered README rewrite.`;
  }

  const prompt = `Optimize this GitHub README for maximum stars and conversions.
Repo: ${repoName}
Current README:
---
${currentReadme?.slice(0, 2000) || '(empty)'}
---

Competitor repos to learn from: ${competitors || 'general best practices'}

Requirements:
- Keep it concise and scannable
- Add clear value proposition at top
- Add Quick Start section
- Add badges
- End with a clear CTA (Sponsor / Star / Fork)
Output the improved README content (markdown format), no explanation.`;

  try {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
      }),
      timeout: 30000,
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '[AI optimization failed]';
  } catch (e) {
    return `[AI optimization error: ${e.message}]`;
  }
}

// --- Tool handlers ---

async function analyzeRepo(args) {
  const repo = args.repo; // format: owner/repo
  const token = process.env.GITHUB_TOKEN; // optional, increases rate limit

  const [owner, repoName] = repo.split('/');
  if (!owner || !repoName) throw new Error('Invalid repo format. Use: owner/repo');

  const data = await githubApi(`/repos/${owner}/${repoName}`, token);

  // Get star history (last 100 stargazers with dates)
  let stargazers = [];
  try {
    stargazers = await githubApiPaginated(`/repos/${owner}/${repoName}/stargazers`, token, 1);
  } catch (e) {}

  // Get contributors
  let contributors = [];
  try {
    contributors = await githubApiPaginated(`/repos/${owner}/${repoName}/contributors`, token, 1);
  } catch (e) {}

  // Get languages
  let languages = {};
  try {
    languages = await githubApi(`/repos/${owner}/${repoName}/languages`, token);
  } catch (e) {}

  const starDates = stargazers.map(s => s.starred_at).filter(Boolean);
  const recentStars = starDates.filter(d => new Date(d) > new Date(Date.now() - 30*86400000)).length;

  return {
    repo: `${owner}/${repoName}`,
    description: data.description,
    stars: data.stargazers_count,
    forks: data.forks_count,
    watchers: data.watchers_count,
    openIssues: data.open_issues_count,
    language: data.language,
    languages,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    pushedAt: data.pushed_at,
    contributorCount: contributors.length,
    topContributors: contributors.slice(0, 5).map(c => ({ username: c.login, contributions: c.contributions })),
    recentStars30d: recentStars,
    growthRate: `${recentStars} stars in last 30 days`,
    homepage: data.homepage,
    topics: data.topics || [],
    freeFeature: true,
  };
}

async function compareRepos(args) {
  const repos = args.repos; // array of "owner/repo"
  const token = process.env.GITHUB_TOKEN;

  const results = [];
  for (const repo of repos) {
    try {
      const [owner, repoName] = repo.split('/');
      const data = await githubApi(`/repos/${owner}/${repoName}`, token);
      results.push({
        repo,
        stars: data.stargazers_count,
        forks: data.forks_count,
        watchers: data.watchers_count,
        language: data.language,
        updatedAt: data.updated_at,
        topics: data.topics || [],
      });
    } catch (e) {
      results.push({ repo, error: e.message });
    }
  }

  // Sort by stars
  results.sort((a, b) => (b.stars || 0) - (a.stars || 0));

  return {
    compared: repos.length,
    ranking: results,
    analysis: `Top repo: ${results[0]?.repo} (${results[0]?.stars} stars). Your repo ranks #${results.findIndex(r => r.repo === args.repos[0]) + 1}.`,
    freeFeature: true,
  };
}

async function optimizeReadme(args) {
  if (!isPremium()) {
    throw new Error('PREMIUM FEATURE. Get a license key to unlock AI README optimization. Visit: https://github.com/sponsors/1036007003-wq');
  }

  const repo = args.repo;
  const competitors = args.competitors; // optional: "owner/repo,owner2/repo2"
  const token = process.env.GITHUB_TOKEN;

  const [owner, repoName] = repo.split('/');
  
  // Get current README
  let currentReadme = '';
  try {
    const readmeData = await githubApi(`/repos/${owner}/${repoName}/readme`, token);
    currentReadme = Buffer.from(readmeData.content, 'base64').toString('utf8');
  } catch (e) {}

  const optimized = await aiOptimizeReadme(repo, currentReadme, competitors);

  return {
    repo,
    currentLength: currentReadme.length,
    optimizedReadme: optimized,
    premiumFeature: true,
    nextStep: 'Copy the optimized README and replace your current one. Then commit and push.',
  };
}

async function findSimilarRepos(args) {
  const repo = args.repo;
  const topic = args.topic; // optional, overrides auto-detect
  const token = process.env.GITHUB_TOKEN;

  const [owner, repoName] = repo.split('/');
  
  // Get repo topics
  let topics = [];
  if (!topic) {
    try {
      const data = await githubApi(`/repos/${owner}/${repoName}`, token);
      topics = data.topics || [];
    } catch (e) {}
  }

  const searchTopic = topic || topics[0] || 'mcp';
  
  // Search GitHub for repos with same topic, sorted by stars
  const searchData = await githubApi(`/search/repositories?q=topic:${searchTopic}&sort=stars&order=desc&per_page=10`, token);

  const similar = (searchData.items || []).filter(r => r.full_name !== repo).slice(0, 8).map(r => ({
    repo: r.full_name,
    stars: r.stargazers_count,
    description: r.description,
    url: r.html_url,
    topics: r.topics || [],
  }));

  return {
    originalRepo: repo,
    searchTopic,
    similarRepos: similar,
    tip: 'Study the top repos\' READMEs and features. What are they doing better?',
    freeFeature: true,
  };
}

async function trackStarGrowth(args) {
  const repo = args.repo;
  const token = process.env.GITHUB_TOKEN;

  const [owner, repoName] = repo.split('/');
  
  // Get stargazers with dates (last 100)
  const stargazers = await githubApiPaginated(`/repos/${owner}/${repoName}/stargazers`, token, 1);
  
  // Group by month
  const byMonth = {};
  stargazers.forEach(s => {
    if (!s.starred_at) return;
    const month = s.starred_at.slice(0, 7); // YYYY-MM
    byMonth[month] = (byMonth[month] || 0) + 1;
  });

  const sortedMonths = Object.entries(byMonth).sort();
  const totalStars = stargazers.length;

  return {
    repo,
    totalStarsTracked: totalStars,
    note: 'GitHub API returns max 100 recent stargazers. For full history, use a third-party service like star-history.com',
    growthByMonth: sortedMonths,
    recentGrowth: sortedMonths.length > 0 ? sortedMonths[sortedMonths.length - 1] : null,
    freeFeature: true,
  };
}

// --- MCP Server ---

const server = new Server(
  { name: 'github-stars-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'analyze_repo',
        description: 'Deep analysis of any GitHub repo: stars, forks, growth rate, contributors, languages. Free feature.',
        inputSchema: {
          type: 'object',
          properties: {
            repo: { type: 'string', description: 'Repo name (format: owner/repo, e.g. "facebook/react")' },
          },
          required: ['repo'],
        },
      },
      {
        name: 'compare_repos',
        description: 'Compare multiple GitHub repos by stars, forks, activity. Free feature.',
        inputSchema: {
          type: 'object',
          properties: {
            repos: { type: 'array', items: { type: 'string' }, description: 'Array of repo names (format: owner/repo)' },
          },
          required: ['repos'],
        },
      },
      {
        name: 'optimize_readme',
        description: 'AI-powered README optimization to get more stars. PREMIUM feature (GitHub Sponsors).',
        inputSchema: {
          type: 'object',
          properties: {
            repo: { type: 'string', description: 'Your repo name (format: owner/repo)' },
            competitors: { type: 'string', description: 'Comma-separated competitor repos (optional)' },
          },
          required: ['repo'],
        },
      },
      {
        name: 'find_similar_repos',
        description: 'Find repos similar to yours (by topic/niche). Learn from what they do well. Free feature.',
        inputSchema: {
          type: 'object',
          properties: {
            repo: { type: 'string', description: 'Your repo name (format: owner/repo)' },
            topic: { type: 'string', description: 'Topic to search (optional, auto-detected from repo)' },
          },
          required: ['repo'],
        },
      },
      {
        name: 'track_star_growth',
        description: 'Track star growth over time (last 100 stargazers). Free feature.',
        inputSchema: {
          type: 'object',
          properties: {
            repo: { type: 'string', description: 'Repo name (format: owner/repo)' },
          },
          required: ['repo'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;

    switch (name) {
      case 'analyze_repo':
        result = await analyzeRepo(args);
        break;
      case 'compare_repos':
        result = await compareRepos(args);
        break;
      case 'optimize_readme':
        result = await optimizeReadme(args);
        break;
      case 'find_similar_repos':
        result = await findSimilarRepos(args);
        break;
      case 'track_star_growth':
        result = await trackStarGrowth(args);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('GitHub Stars MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
