# Running OMP in Workshop on Ubuntu

This guide sets up [Workshop](https://ubuntu.com/workshop/docs/) and
[OMP (oh-my-pi)](https://github.com/can1357/oh-my-pi) **on the Ubuntu laptop**.
OMP uses GitHub Copilot and requests approval for edits and shell commands,
including targeted test runs inside the workshop. Dependency installs, builds,
and full-suite checks remain under your explicit direction.

**This phase does not require your Mac to reach the laptop.** Run the commands
from a local terminal on Ubuntu. Mac-to-laptop SSH, VPN/firewall changes, and
JetBrains Gateway are a later phase; do not open ports or copy SSH credentials
as part of this setup.

## What is isolated, and what is not

```text
Ubuntu laptop
├── ~/workshops/maas-ui              Dedicated checkout on Ubuntu
├── ~/omp-workshop-records          Setup records outside the project mount
└── Workshop / LXD container "dev"
    ├── /project                   Live writable mount of the checkout
    ├── Node.js, Yarn, Bun, OMP
    ├── /home/workshop/.omp         Container-local OMP login and sessions
    └── Project commands           Approved OMP tests or your manual commands

Mac: no connection or mounted directory in this phase
```

Workshop is a development environment, not a complete hostile-agent sandbox.
Its [coding-agent security guidance](https://ubuntu.com/workshop/docs/security/#coding-agents)
explicitly documents these boundaries:

| Surface                        | Actual behavior                                                                                                                                                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Command execution              | OMP and commands launched with `workshop exec` run inside an unprivileged LXD container, sharing the Ubuntu host's kernel.                                                                                        |
| Project files                  | The entire Ubuntu checkout is mounted read-write at `/project`, including ignored files, `.git`, and Workshop definitions. Changes are immediately visible both ways; no commit is required.                      |
| Git configuration              | Unlike the previous Docker recipe, this setup does **not** mount `.git/config` or `.git/hooks` read-only. Do not run host Git commands against the checkout after agent activity without reviewing that metadata. |
| Privileges inside the workshop | The `workshop` user can use passwordless sudo. This does not grant host root directly, but files owned by container root are not protected from an execution-capable agent.                                       |
| Network                        | Outbound traffic is open by default. There is no Squid allowlist here; reachable company services and the internet may be accessible.                                                                             |
| Interfaces                     | Connected mounts, SSH agents, secrets, desktop sessions, devices, and tunnels can extend access. Do not connect them merely for convenience.                                                                      |
| Approval prompts               | OMP tool policy is an application-level safeguard, not OS-enforced per-file access control. Approved edits can contain code you execute later.                                                                    |

Use a dedicated, secret-free clone, not your existing working checkout or a
linked Git worktree. Keep host-side watchers and automatic project execution
stopped. All project commands in this guide run **inside** Workshop.

Get company approval for Workshop/LXD, the chosen AI provider, and any code sent
to that provider. If policy requires network allowlisting, have the approved
network controls in place **before authenticating or running OMP**. This guide
does not replace them with proxy environment variables or container-local
firewall rules.

## 1. Install Workshop and check LXD

**Ubuntu host terminal.**

Workshop currently requires **LXD 6.8 or newer** and supports Ubuntu and other
snap-enabled Linux distributions. Check the machine before changing anything:

```bash
lsb_release -ds
snap version
snap list lxd workshop
```

Missing snaps will be reported. Follow the relevant installation path, not both:

```bash
# If LXD is not installed:
sudo snap install --channel=6/stable lxd

# If Workshop is not installed:
sudo snap install --classic workshop
```

For an existing LXD installation below the required version, coordinate an
upgrade with its administrator. The documented snap command is
`sudo snap refresh --channel=6/stable lxd`; do not change the channel or restart
shared infrastructure without approval. Likewise, refresh an existing Workshop
installation through the company's normal update process.

Check readiness and record the installed versions:

```bash
sudo lxd waitready
sudo lxc version
snap list lxd workshop
workshop --help
```

Do not run an unattended `lxd init`, recreate storage/networking, or add yourself
to the `lxd` group just to follow this guide. Workshop's daemon manages its LXD
resources; normal Workshop commands do not require `sudo`. If launch reports a
host configuration problem, inspect its error and consult the administrator.

See the [official installation tutorial](https://ubuntu.com/workshop/docs/tutorial/part-1-get-started/).

## 2. Create a dedicated project checkout

**Ubuntu host terminal, before any agent activity.**

Install host Git through the approved package-management process if it is
missing. Clone using HTTPS without embedding a token in the URL:

```bash
mkdir -p "$HOME/workshops" "$HOME/omp-workshop-records"
git clone https://github.com/abuyukyi101198/maas-ui.git "$HOME/workshops/maas-ui"
cd "$HOME/workshops/maas-ui"
```

If you need another branch, select it before starting OMP.
Do not overwrite an existing checkout or discard local work.

Do not copy the Mac's `node_modules`, `.env` files, OMP login, SSH keys, or
credential-bearing Git configuration into this clone. `.gitignore` does not
hide files from the workshop. Starting OMP in a subdirectory does not narrow
the `/project` mount.

Workshop creates `.workshop.lock` to identify this project. Keep it in place;
do not commit it or copy it to another project:

```bash
printf '\n.workshop.lock\n' >> .git/info/exclude
```

The `.workshop/` definition directory is different: it is ordinary configuration
that can be reviewed and version-controlled.

## 3. Define the workshop

**Ubuntu host terminal, in `~/workshops/maas-ui`.**

Use Canonical's [Node SDK](https://github.com/canonical/node-sdk), which provides
Node.js and Corepack. Inspect the publisher and verify that `22/stable` is
available for `ubuntu@24.04` on your laptop's architecture:

```bash
sdk find node
sdk info node
```

If that channel/base combination is unavailable, stop and choose a supported
combination with the administrator rather than silently switching to an
unrelated SDK or development channel.

Create the directory, then save the following definition as
`.workshop/dev.yaml`. If a definition already exists, review it rather than
overwriting it:

```bash
mkdir -p .workshop
```

```yaml
name: dev
base: ubuntu@24.04
runtime: lxd-container
sdks:
  - name: node
    channel: 22/stable
```

There are deliberately no actions, extra host mounts, secret/SSH-agent
connections, desktop connections, or debugger tunnels. The Node SDK has
automatically connected package-cache mounts; inspect their actual sources
after launch. An empty explicit connections list would not disable auto-connect.

Keep a trusted copy of the definition outside the writable project:

```bash
cp .workshop/dev.yaml "$HOME/omp-workshop-records/maas-ui-dev.yaml"
workshop list
```

Expected: the `dev` workshop is listed as `Off`.
`22/stable` tracks updates; it is not an immutable revision pin. Record the
installed SDK revision after launch and review changes before refreshing.

## 4. Launch and inspect the boundaries

**Ubuntu host terminal, in the project directory.**

```bash
workshop launch dev
workshop info dev
workshop connections dev
workshop changes
workshop tasks
```

Expect `status: ready`, `runtime: lxd-container`, the correct Ubuntu project
path, and a workshop hostname. Save the environment record outside the mount:

```bash
workshop info dev > "$HOME/omp-workshop-records/maas-ui-info.txt"
```

Inspect the connection listing: Node's package-cache mounts are expected;
connected host SSH-agent, secret, desktop, device, or tunnel interfaces are
not part of this recipe. Inspect any unexpected connection before proceeding.
Do not mount the host home directory, Docker/LXD sockets, or another
repository's `.git`.

Check execution context from the host:

```bash
workshop exec dev -- whoami
workshop exec dev -- pwd
workshop exec dev -- cat /etc/os-release
workshop exec dev -- findmnt -T /project
workshop exec dev -- node --version
workshop exec dev -- npm --version

# Demonstrates a documented limitation, not an isolation failure:
workshop exec dev -- sudo -n true
```

Expect user `workshop`, working directory `/project`, Ubuntu 24.04, Node 22,
a writable project mount, and successful container sudo. Do not mistake the
word "unprivileged" in LXD terminology for "cannot become root in the container."

If launch or setup fails, use `workshop changes`, `workshop tasks`, and
`workshop warnings` on the host. Do not respond by disabling confinement or
granting extra host access.

## 5. Install Bun, Yarn, and OMP inside the workshop

**First, from the Ubuntu host:**

```bash
workshop shell dev
```

**The following commands run inside that shell**, as `workshop`, not on the
Ubuntu host. Confirm `pwd` prints `/project`.

```bash
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  ca-certificates curl git gh ripgrep unzip build-essential python3
```

Install exact published versions rather than unreviewed `latest` releases.
The example uses OMP `18.16.0`, whose published package requires Bun `>=1.4.4`,
Bun `1.4.4`, and Yarn Classic `1.22.22`. Verify these releases against your
company's software policy; their publication is not a security audit.

```bash
(
  set -eu
  cd /home/workshop
  export PATH="$HOME/.local/bin:$PATH"
  npm install --global --prefix "$HOME/.local" bun@1.4.4 yarn@1.22.22
  BUN_INSTALL_GLOBAL_DIR="$HOME/.local/share/omp" \
    BUN_INSTALL_BIN="$HOME/.local/bin" \
    "$HOME/.local/bin/bun" install --global @oh-my-pi/pi-coding-agent@18.16.0
  "$HOME/.local/bin/bun" --version
  "$HOME/.local/bin/yarn" --version
  "$HOME/.local/bin/omp" --version
  "$HOME/.local/bin/omp" --help
)
```

Installers and package lifecycle scripts execute inside the workshop and have
its access, including the writable project. They are not inert downloads.
No host Node.js, Bun, or OMP installation is required.

These are manual container installations, not a custom SDK. They survive a
normal stop/start, but do not assume they or container-local OMP state survive
refresh, restore, removal, or recreation. See maintenance below.

## 6. Set up a supervised editing and testing launcher

**Inside the workshop shell.**

This selects file-reading/search/edit tools and Bash, with `always-ask`
approvals. OMP can run targeted tests through Bash after you approve each
command. `eval`, browser, subagent, and LSP tools remain unavailable, and
extension discovery stays disabled.

Before launching, inspect project agent configuration such as `.omp/`,
`.claude/`, and MCP/plugin definitions. Do not add executable plugins, MCP
servers, custom tools, or explicit extensions to this setup. Tool selection
is not a substitute for trusting the agent application and its startup code.

Create a policy overlay and launcher outside the shared project. The overlay
forces edit/write and Bash prompts even if project settings contain auto-allow
policies, denies the other named execution tools, and disables `xd://` tool
dispatch through read/write. The explicit tool list remains the primary tool
selection:

```bash
mkdir -p "$HOME/.local/bin" "$HOME/.config"
cat > "$HOME/.config/omp-edit.yml" <<'EOF'
tools:
  xdev: false
  approval:
    edit: prompt
    write: prompt
    bash: prompt
    eval: deny
    task: deny
    browser: deny
    lsp: deny
EOF
chmod 600 "$HOME/.config/omp-edit.yml"

cat > "$HOME/.local/bin/omp-edit" <<'EOF'
#!/bin/sh
set -eu
export PATH="/home/workshop/.local/bin:$PATH"
cd /project
exec /home/workshop/.local/bin/omp \
  --config /home/workshop/.config/omp-edit.yml \
  --approval-mode always-ask \
  --tools read,grep,find,edit,write,bash \
  --no-lsp \
  --no-extensions \
  --no-skills \
  --append-system-prompt 'For validation, run the smallest relevant Vitest selection with --run. Do not start watch mode. Run the full suite, installs, builds, or lint only when explicitly requested by the user. Do not repeat test runs without a relevant code change or user request.' \
  "$@"
EOF
chmod 700 "$HOME/.local/bin/omp-edit"
```

Use this launcher rather than the unwrapped OMP executable, whose default
approval mode can allow tools without prompting. Additional arguments are
forwarded, for example `--continue`; do not add `--yolo`, `--auto-approve`,
auto-allow tool policies, or session-wide execution grants.

The appended instruction limits unnecessary test runs; it is workflow guidance,
not a shell allowlist. Bash is not restricted to Yarn, so inspect the complete
command and deny unexpected scripts, compound commands, installs, or privilege
changes. Approval authorizes that process and its subprocesses, not individual
file writes. Tests still have access to the writable Ubuntu checkout, network,
and other workshop resources.

If you followed the earlier edit-only version, recreate both the policy file
and launcher above, then exit and restart OMP. Existing sessions do not acquire
the updated startup tool list.

If your selected release rejects a flag/tool, stop and check its
[CLI reference](https://github.com/can1357/oh-my-pi/blob/09eac7d856f922a362c0158010906807e86ac4ef/docs/cli-reference.md).
Do not remove the restrictions just to make startup work.

**This is supervised editing and execution, not a new security boundary.**
File tools and approved commands can modify executable code, Git metadata, or
OMP's own settings. Reject unexpected targets, changes that relax this
launcher, or requests to enable additional execution tools. Recheck the
effective tools and approvals after updates. Read approval behavior is
described in OMP's
[approval documentation](https://github.com/can1357/oh-my-pi/blob/09eac7d856f922a362c0158010906807e86ac4ef/docs/approval-mode.md).

### Alias the launcher as `omp`

**Inside the workshop's interactive Bash shell**, not on Ubuntu's host shell
or your Mac, add the alias to `~/.bashrc` and activate it for the current shell:

```bash
printf '\n%s\n' "alias omp='/home/workshop/.local/bin/omp-edit'" >> "$HOME/.bashrc"
alias omp='/home/workshop/.local/bin/omp-edit'
type omp
```

Expected: `omp` is an alias for `/home/workshop/.local/bin/omp-edit`.
Add the persistent line only once. Future interactive Bash sessions that load
this `.bashrc`, including workshop terminals, can use:

```bash
omp
# Or resume with the same launcher restrictions:
omp --continue
```

The launcher calls the real executable by absolute path, so the alias does not
recurse. The alias is a convenience, not an enforcement mechanism: noninteractive
commands and other shells may not load it. Keep using
`workshop exec dev -- /home/workshop/.local/bin/omp-edit` from the Ubuntu host;
do not replace that with `workshop exec dev -- omp` and assume it is wrapped.
Recreate the alias if container lifecycle operations reset your shell files.

## 7. Log in to GitHub Copilot

**Inside the workshop's interactive Bash shell, after verifying the alias:**

```bash
omp
```

Run `/login`, choose **GitHub Copilot**, and complete the device-code flow in
your browser. Use an account and provider approved for company code. The login
is stored inside the workshop under `/home/workshop/.omp`, not in `/project`
or your Mac's OMP configuration.

Copilot OAuth is independent of any GitHub PAT. The
[inspected OAuth implementation](https://github.com/can1357/oh-my-pi/blob/09eac7d856f922a362c0158010906807e86ac4ef/packages/ai/src/registry/oauth/github-copilot.ts)
requests `read:user` and uses different OAuth apps for public GitHub and
Enterprise hosts. Check the consent page, existing access, and the actual
authorized app grant; old or Enterprise credentials may have broader access.
Do not infer read-only repository access from the requested scope alone.

Do not approve repository-write access for this setup. All processes with
sufficient access inside the workshop can read its stored credentials.
Deleting the workshop does not revoke an OAuth grant.

### Optional: a read-only GitHub PAT

The public HTTPS clone and OMP's Copilot login do not require a PAT. Only create
one if you need private read access or authenticated GitHub API queries.
Limit it to the necessary repositories, a short expiry, and read-only
Contents, Metadata, Issues, and Pull requests permissions.

Do not put it in the project, the Workshop definition, shell profiles, command
arguments, or Git remote URLs. For a single manual command, use this in **Bash
on the Ubuntu host**, with shell tracing disabled:

```bash
(
  set +x
  read -r -s -p 'Read-only GitHub token: ' GH_TOKEN
  printf '\n'
  : "${GH_TOKEN:?No token entered}"
  export GH_TOKEN
  workshop exec --env GH_TOKEN dev -- gh repo view abuyukyi101198/maas-ui --json name
)
```

Only the variable name is passed to Workshop. The subshell avoids retaining
the variable in your interactive host shell. The receiving command and other
processes with sufficient access inside the workshop can still read the token
while it is present; this is not per-process secret isolation.

Do not connect the host SSH agent or keyring just to avoid this step.

## 8. Verify OMP before giving it real work

Use a fresh supervised session and a disposable, non-sensitive file:

1. Ask OMP to propose a small file addition. Verify an approval prompt appears
   **before** the write; deny it and confirm that no file was created.
2. Repeat and approve the addition. Read the file yourself inside Workshop.
   The same file is immediately present in the dedicated Ubuntu checkout.
3. Ask OMP to run a harmless Bash command such as `printf 'approval-check\n'`.
   Verify it asks for approval; deny the request and confirm it is not executed
   or retried through another tool.
4. Ask OMP to run `pwd`, approve that single command, and expect `/project`.
   Do not grant approval to Bash for the whole session.
5. Confirm `eval`, browser, and subagent tools are not available. Reject
   requests to relax the policy or install extensions to bypass approval.

Do not give OMP project work if edits or Bash commands execute without approval,
or additional execution tools are unexpectedly available. These are behavioral
checks, not proof against malicious code in OMP itself.

Stop OMP after the check. Remove the disposable file yourself inside Workshop.
Then exit the workshop shell to return to the Ubuntu host.

## 9. Install dependencies and run approved checks

**Ubuntu host terminal, in `~/workshops/maas-ui`.** Each command below executes
in the workshop, not on the host:

```bash
workshop exec --env CYPRESS_INSTALL_BINARY=0 dev -- \
  /home/workshop/.local/bin/yarn install --frozen-lockfile
```

After installation, restart OMP from the host with
`workshop exec dev -- /home/workshop/.local/bin/omp-edit`. For ordinary
iteration, let OMP propose the smallest relevant test selection and approve
the command:

```bash
# OMP runs this inside /project; replace the path with an existing test:
yarn test --run src/path/to/component.test.tsx
```

Verify that the Bash approval appears before the test starts. Use `--run` to
exit after one run; do not approve bare `yarn test`, which can enter watch mode.
Review results before repeating a run, and only expand to the full suite when
you explicitly request it.

You can still run a selected test yourself from the Ubuntu host:

```bash
# Replace the path with an existing test:
workshop exec --env CI=true dev -- \
  /home/workshop/.local/bin/yarn test --run src/path/to/component.test.tsx
```

For an explicitly requested full validation, either approve OMP's corresponding
commands or run these yourself from the Ubuntu host:

```bash
workshop exec --env CI=true dev -- \
  /home/workshop/.local/bin/yarn test --run

workshop exec dev -- /home/workshop/.local/bin/yarn lint
```

Review changes before running commands. An unchanged `yarn test` still executes
modified tests, application code, configuration, and dependencies.
Package installation runs lifecycle scripts too.

Here, `node_modules` is under `/project`, so it is also on the **Ubuntu**
checkout; there is no separate Docker dependency volume and nothing is shared
with your Mac. Do not install dependencies into that checkout from another
environment. Pause OMP and stop tests/watchers before switching branches,
editing the same files, or reinstalling dependencies.

After manifest or branch changes, rerun the install command inside Workshop.
OMP does not automatically reread changed files or reinstall packages.
Cypress is intentionally not downloaded; its E2E tests need separate setup.

## 10. Daily use, review, and maintenance

**Ubuntu host terminal:**

```bash
cd "$HOME/workshops/maas-ui"

# Only if currently stopped:
workshop start dev

workshop exec dev -- /home/workshop/.local/bin/omp-edit

# For your own commands in another terminal:
workshop shell dev

# Inside that interactive Bash shell, `omp` uses the alias from section 6.

# After exiting OMP and finishing other work:
workshop stop dev
```

`workshop stop` / `start` retain the container. Stopping interrupts processes;
wait for installs and other important work to finish first.

### Review beyond the uncommitted Changes view

Prefer making commits and pushes yourself. Run project Git commands inside
Workshop after inspecting hooks/configuration; don't expose host credentials
to agent-controlled Git metadata.

Review staged and unstaged changes before making your own commits. If OMP has
made commits, inspect them in Git history or compare against a known reviewed
commit rather than relying only on the uncommitted Changes view.
Ignored/untracked files are not fully covered by an ordinary diff.
Inspect new files, relevant ignored files, `.git`, agent
configuration, and executable project configuration separately. Disable hooks,
fsmonitor, external diffs/text conversion, and pagers when using Git to inspect
untrusted changes. A clean working tree is not a safety verdict.

`workshop changes` reports Workshop operations such as launch and refresh.
It is **not** a version-control log of edits OMP made.

### Refresh, restore, and removal are not daily startup commands

Before refreshing, stop OMP and review `.workshop/`, any in-project SDKs, and
other workshop definitions. The agent can edit these through `/project`;
launch/refresh can act on their resource declarations. Compare the definition
with the trusted copy outside the mount:

```bash
diff -u "$HOME/omp-workshop-records/maas-ui-dev.yaml" .workshop/dev.yaml
```

After reviewing and backing up needed state, `workshop refresh dev` updates the
base/SDKs and applies the definition. Recheck `workshop info dev`,
`workshop connections dev`, tool versions, and OMP approvals afterward.
Reinstall the manual tools and recreate the launcher if necessary.

`workshop restore dev` deliberately rolls the container filesystem back to the
last launch/refresh snapshot and resets interface connections. It can remove
manual tools, launcher changes, and OMP login/session data. `workshop remove dev`
destroys the workshop. Neither operation should be treated as an undo of edits
to the writable host project or persistent cache mounts.

The Node SDK persists its declared package-cache mounts. This recipe does not
add a persistent mount for OMP credentials or global installations. Back up
needed sessions through an approved process before lifecycle changes; never
put credential-bearing backups in the project or a Git commit. Revoke tokens
separately if the workshop or its credentials may have been compromised.

## Ready for the later SSH/Gateway phase

The local setup is ready when:

- `workshop info dev` reports `ready` with the expected project and runtime.
- Unexpected host interfaces are absent from `workshop connections dev`.
- Node, Yarn, Bun, and OMP run inside the workshop.
- Copilot login works with the intended permissions.
- OMP prompts for edits and each Bash command; other execution tools remain
  unavailable in the supervised session.
- Dependencies install and an approved targeted test runs inside Workshop
  without entering watch mode, with any failures investigated.

Save the workshop hostname from `workshop info dev`. Do not configure Gateway
on the Ubuntu host as a substitute for the intended Mac client, open the LXD
API, expose the workshop publicly, or copy Workshop's CA private key.

Next, independently confirm approved SSH access from your Mac to the Ubuntu
laptop. Only then configure access to the workshop itself and use
[Workshop's JetBrains Gateway integration](https://ubuntu.com/workshop/docs/how-to/develop-with-workshops/run-jetbrains-gateway/).
Workshop's automatic SSH configuration is installed on Ubuntu; your Mac does
not automatically inherit its routing, hostname resolution, certificates, or
host trust.

## Sources and validation scope

- [Workshop installation and lifecycle](https://ubuntu.com/workshop/docs/tutorial/part-1-get-started/)
- [Workshop security and coding agents](https://ubuntu.com/workshop/docs/security/)
- [Workshop definition reference](https://ubuntu.com/workshop/docs/reference/definition-files/workshop-definition/)
- [Workshop command execution](https://ubuntu.com/workshop/docs/reference/cli/workshop-exec/)
- [Canonical Node SDK](https://github.com/canonical/node-sdk)
- [OMP CLI and approval documentation](https://github.com/can1357/oh-my-pi/tree/09eac7d856f922a362c0158010906807e86ac4ef/docs)

The instructions were checked against upstream documentation and published
package metadata. They have **not** been executed on your Ubuntu laptop.
The local acceptance checks above are required before relying on this setup.
