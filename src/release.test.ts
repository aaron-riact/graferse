import { readFileSync } from 'fs'
import { join } from 'path'

const workflow = readFileSync(
    join(process.cwd(), '.github/workflows/release.yml'),
    'utf8',
)
const publishJob = workflow.indexOf('  publish:')
const prepareWorkflow = workflow.slice(0, publishJob)
const publishWorkflow = workflow.slice(publishJob)

describe('release workflow privilege boundary', () => {
    test('prepares only the default branch with read-only checkout', () => {
        expect(prepareWorkflow).toContain(
            "if: github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
        )
        expect(prepareWorkflow).toContain('contents: read')
        expect(prepareWorkflow).toContain('persist-credentials: false')
        expect(prepareWorkflow).not.toContain('GITHUB_TOKEN')
    })

    test('does not install or test package code in the write-capable job', () => {
        expect(publishWorkflow).toContain('environment: release')
        expect(publishWorkflow).toContain('contents: write')
        expect(publishWorkflow).not.toContain('npm ci')
        expect(publishWorkflow).not.toContain('npm test')
        expect(publishWorkflow).not.toContain('npm run lint')
        expect(publishWorkflow).not.toContain('npm run typecheck')
    })

    test('passes a real version from prepare to publish', () => {
        expect(prepareWorkflow).toContain('--no-git-tag-version')
        expect(prepareWorkflow).toContain('>> "$GITHUB_OUTPUT"')
        expect(publishWorkflow).toContain('test -n "$VERSION"')
    })

    test('releases the tested commit with a pushed annotated tag', () => {
        expect(publishWorkflow).toContain('ref: ${{ github.sha }}')
        expect(publishWorkflow).toContain('git tag -a ')
        expect(publishWorkflow).toContain('git push --atomic origin "HEAD:refs/heads/$BRANCH" "refs/tags/v$VERSION"')
    })

    test('dispatches the npm publish for the new tag', () => {
        expect(publishWorkflow).toContain('actions: write')
        expect(publishWorkflow).toContain('gh workflow run npm-publish.yml --ref "v$VERSION"')
        const npmPublish = readFileSync(
            join(process.cwd(), '.github/workflows/npm-publish.yml'),
            'utf8',
        )
        expect(npmPublish).toContain('workflow_dispatch:')
        expect(npmPublish).toContain("startsWith(github.ref, 'refs/tags/v')")
    })
})
