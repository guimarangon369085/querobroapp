import { execFileSync } from 'node:child_process';

const REQUIRED_CHECKS = [
  'CI / build',
  'Basic Test / test',
  'Dependency Review / dependency-review',
  'CodeQL / Analyze (javascript-typescript)',
  'Secret Scan / gitleaks',
  'Secret Scan / local-guard',
  'Secret Policy Gate / policy-gate'
];

function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function parseRepoFromRemote() {
  const remote = runGit(['remote', 'get-url', 'origin']);

  let match = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/.exec(remote);
  if (match) return { owner: match[1], repo: match[2] };

  match = /^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/.exec(remote);
  if (match) return { owner: match[1], repo: match[2] };

  throw new Error(`Nao foi possivel extrair owner/repo do remote origin: ${remote}`);
}

function getToken() {
  return process.env.GITHUB_ADMIN_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
}

function getArgValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

async function ghApi(
  path,
  { method = 'GET', token, body = null, accept = 'application/vnd.github+json', allow404 = false } = {}
) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (response.status === 404 && allow404) {
    return { status: 404, data: null, raw: '' };
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${method} ${path} failed (${response.status}): ${text}`);
  }

  if (response.status === 204) {
    return { status: 204, data: null, raw: '' };
  }

  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  return { status: response.status, data, raw };
}

function hasAllChecks(contexts) {
  const set = new Set(contexts || []);
  return REQUIRED_CHECKS.every((entry) => set.has(entry));
}

function getSecurityAnalysisStatus(repoData, key) {
  const status = repoData?.security_and_analysis?.[key]?.status;
  if (status === 'enabled' || status === 'disabled') return status;
  return 'unavailable';
}

function resolveAutomatedFixesState({ secFixesStatus, dependabotSecurityUpdatesStatus }) {
  if (secFixesStatus === 204) return 'enabled';
  if (dependabotSecurityUpdatesStatus === 'enabled') return 'enabled';
  if (dependabotSecurityUpdatesStatus === 'disabled') return 'disabled';
  if (secFixesStatus === 404) return 'unavailable_or_disabled';
  return 'unknown';
}

function printLine(label, value) {
  console.log(`${label}: ${value}`);
}

async function collectState({ owner, repo, branch, token }) {
  const repoInfo = await ghApi(`/repos/${owner}/${repo}`, { token });
  const protection = await ghApi(`/repos/${owner}/${repo}/branches/${branch}/protection`, { token, allow404: true });
  const vulnerabilityAlerts = await ghApi(`/repos/${owner}/${repo}/vulnerability-alerts`, { token, allow404: true });
  const automatedSecurityFixes = await ghApi(`/repos/${owner}/${repo}/automated-security-fixes`, {
    token,
    allow404: true
  });

  const checks = protection.data?.required_status_checks?.contexts || [];
  const missingChecks = REQUIRED_CHECKS.filter((entry) => !checks.includes(entry));

  const advancedSecurity = getSecurityAnalysisStatus(repoInfo.data, 'advanced_security');
  const secretScanning = getSecurityAnalysisStatus(repoInfo.data, 'secret_scanning');
  const secretScanningPushProtection = getSecurityAnalysisStatus(repoInfo.data, 'secret_scanning_push_protection');
  const dependabotSecurityUpdates = getSecurityAnalysisStatus(repoInfo.data, 'dependabot_security_updates');

  const automatedFixesState = resolveAutomatedFixesState({
    secFixesStatus: automatedSecurityFixes.status,
    dependabotSecurityUpdatesStatus: dependabotSecurityUpdates
  });

  return {
    owner,
    repo,
    branch,
    branchProtectionEnabled: protection.status === 200,
    requiredChecksComplete: hasAllChecks(checks),
    missingChecks,
    vulnerabilityAlertsEnabled: vulnerabilityAlerts.status === 204,
    automatedSecurityFixesState: automatedFixesState,
    securityAnalysis: {
      advancedSecurity,
      secretScanning,
      secretScanningPushProtection,
      dependabotSecurityUpdates
    }
  };
}

function printState(state) {
  printLine('Repo', `${state.owner}/${state.repo}`);
  printLine('Branch', state.branch);
  printLine('Branch protection', state.branchProtectionEnabled ? 'enabled' : 'disabled');
  printLine('Vulnerability alerts', state.vulnerabilityAlertsEnabled ? 'enabled' : 'disabled');
  printLine('Automated security fixes', state.automatedSecurityFixesState);
  printLine('Required checks complete', state.requiredChecksComplete ? 'yes' : 'no');

  if (state.missingChecks.length > 0) {
    console.log('Missing required checks:');
    for (const entry of state.missingChecks) {
      console.log(`- ${entry}`);
    }
  }

  console.log('Security analysis:');
  printLine('- advanced_security', state.securityAnalysis.advancedSecurity);
  printLine('- secret_scanning', state.securityAnalysis.secretScanning);
  printLine('- secret_scanning_push_protection', state.securityAnalysis.secretScanningPushProtection);
  printLine('- dependabot_security_updates', state.securityAnalysis.dependabotSecurityUpdates);
}

async function applyHardening({ owner, repo, branch, token }) {
  await ghApi(`/repos/${owner}/${repo}/branches/${branch}/protection`, {
    method: 'PUT',
    token,
    body: {
      required_status_checks: {
        strict: true,
        contexts: REQUIRED_CHECKS
      },
      enforce_admins: true,
      required_pull_request_reviews: {
        dismiss_stale_reviews: true,
        required_approving_review_count: 1
      },
      restrictions: null,
      required_conversation_resolution: true,
      allow_force_pushes: false,
      allow_deletions: false
    }
  });

  await ghApi(`/repos/${owner}/${repo}`, {
    method: 'PATCH',
    token,
    body: {
      security_and_analysis: {
        advanced_security: { status: 'enabled' },
        secret_scanning: { status: 'enabled' },
        secret_scanning_push_protection: { status: 'enabled' },
        dependabot_security_updates: { status: 'enabled' }
      }
    }
  }).catch((error) => {
    console.warn(`WARN: nao foi possivel atualizar security_and_analysis diretamente: ${error.message}`);
  });

  await ghApi(`/repos/${owner}/${repo}/vulnerability-alerts`, { method: 'PUT', token, allow404: true });
  await ghApi(`/repos/${owner}/${repo}/automated-security-fixes`, { method: 'PUT', token, allow404: true });

  const state = await collectState({ owner, repo, branch, token });
  printState(state);

  if (!state.branchProtectionEnabled || !state.requiredChecksComplete || !state.vulnerabilityAlertsEnabled) {
    throw new Error('Hardening incompleto: branch protection/checks/vulnerability alerts ainda nao estao conformes.');
  }

  if (state.automatedSecurityFixesState === 'disabled') {
    throw new Error('Hardening incompleto: automated security fixes seguem desativados.');
  }

  if (state.automatedSecurityFixesState === 'unavailable_or_disabled') {
    console.warn(
      'WARN: automated security fixes indisponivel ou nao confirmado por API. Verifique no painel do GitHub.'
    );
  }

  console.log('GitHub hardening aplicado com sucesso.');
}

async function main() {
  const mode = process.argv.includes('--apply') ? 'apply' : 'audit';
  const branch = getArgValue('--branch', 'main');
  const token = getToken();

  if (!token) {
    console.error('Token ausente. Defina GITHUB_ADMIN_TOKEN (ou GH_TOKEN/GITHUB_TOKEN) com permissao admin no repo.');
    process.exit(1);
  }

  const { owner, repo } = parseRepoFromRemote();

  if (mode === 'apply') {
    await applyHardening({ owner, repo, branch, token });
    return;
  }

  const state = await collectState({ owner, repo, branch, token });
  printState(state);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
