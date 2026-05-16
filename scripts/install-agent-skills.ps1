$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$skillsRoot = Join-Path $repoRoot '.agents\skills'
$requiredSkills = @(
  'vercel-react-best-practices',
  'vercel-react-native-skills',
  'vercel-react-view-transitions',
  'shadcn'
)

function Invoke-SkillsAddCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  & pnpm @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "命令执行失败: pnpm $($Arguments -join ' ')"
  }
}

Push-Location $repoRoot
try {
  $missingSkills = $requiredSkills | Where-Object {
    -not (Test-Path -LiteralPath (Join-Path $skillsRoot $_) -PathType Container)
  }

  if ($missingSkills.Count -eq 0) {
    Write-Host '技能目录已齐全，跳过安装命令。'
    $requiredSkills | ForEach-Object {
      Write-Host " - $_"
    }
    return
  }

  Invoke-SkillsAddCommand -Arguments @(
    'dlx',
    'skills',
    'add',
    'https://github.com/vercel-labs/agent-skills',
    '--skill',
    'vercel-react-best-practices',
    '--skill',
    'vercel-react-native-skills',
    '--skill',
    'vercel-react-view-transitions',
    '-a',
    'codex',
    '-a',
    'cursor',
    '--copy',
    '-y'
  )

  Invoke-SkillsAddCommand -Arguments @(
    'dlx',
    'skills',
    'add',
    'shadcn/ui',
    '-a',
    'codex',
    '-a',
    'cursor',
    '--copy',
    '-y'
  )

  $missingSkills = $requiredSkills | Where-Object {
    -not (Test-Path -LiteralPath (Join-Path $skillsRoot $_) -PathType Container)
  }

  if ($missingSkills.Count -gt 0) {
    throw "以下技能目录不存在: $($missingSkills -join ', ')"
  }

  Write-Host '技能安装完成，已确认以下目录存在:'
  $requiredSkills | ForEach-Object {
    Write-Host " - $_"
  }
}
finally {
  Pop-Location
}
