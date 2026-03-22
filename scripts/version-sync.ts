import { spawnSync } from 'node:child_process'

import { getArgValue } from '../src/pipeline/utils'

function execGit(args: string[]) {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} 失败`)
  }

  return result.stdout.trim()
}

async function main() {
  const message = getArgValue('--message') ?? `chore: sync version ${new Date().toISOString()}`
  const tag = getArgValue('--tag')
  const pushTarget = getArgValue('--remote') ?? 'origin'
  const status = execGit(['status', '--short'])

  if (!status) {
    console.log(
      JSON.stringify(
        {
          committed: false,
          pushed: false,
          reason: 'working tree clean',
        },
        null,
        2,
      ),
    )
    return
  }

  execGit(['add', '-A'])
  execGit(['commit', '-m', message])
  if (tag) {
    execGit(['tag', tag])
  }
  execGit(['push', pushTarget, 'main', ...(tag ? ['--tags'] : [])])

  console.log(
    JSON.stringify(
      {
        committed: true,
        pushed: true,
        tag: tag ?? null,
        head: execGit(['rev-parse', '--short', 'HEAD']),
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
