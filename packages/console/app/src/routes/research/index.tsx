import "./index.css"
import { Title, Meta } from "@solidjs/meta"
import { Header } from "~/component/header"
import { Footer } from "~/component/footer"
import { Legal } from "~/component/legal"
import { Faq } from "~/component/faq"
import { useI18n } from "~/context/i18n"
import { LocaleLinks } from "~/component/locale-links"

export default function Research() {
  const i18n = useI18n()
  return (
    <main data-page="research">
      <Title>Research -- Tribunus Compute Evidence</Title>
      <LocaleLinks path="/research" />
      <Meta
        name="description"
        content="Tribunus research on verifiable execution substrates for agentic AI: verifiable inference, governed agents, local-first AI systems, and federated mutual-aid inference."
      />
      <div data-component="container">
        <Header />
        <div data-component="research-content">
          <section data-component="hero">
            <h1>Researching verifiable execution for agentic AI</h1>
            <p>
              Tribunus studies how AI agents, inference engines, tools, and
              distributed runtimes can produce evidence instead of requiring
              blind trust.
            </p>
          </section>

          <section data-component="thesis">
            <h2>Research thesis</h2>
            <p>
              Modern AI safety often focuses on model behavior, model
              evaluations, and deployment policy. Tribunus focuses on the{" "}
              <strong>execution layer</strong> beneath agentic systems. The
              question is not only "what did the model say?" but "what was the
              agent allowed to do, what state did it mutate, which model and
              backend produced the result, what evidence was emitted, and can
              the execution be replayed or audited?"
            </p>
          </section>

          <section data-component="programs">
            <h2>Research programs</h2>

            <div class="program-card">
              <h3>1. Verifiable Inference</h3>
              <p>
                PhaseIR compile-time architecture, compute images, oracle
                validation across backends, deterministic runtime replay,
                numerical tolerance matrices, and structured failure evidence.
                Every inference path is frozen before execution and validated
                against an FP32 reference oracle.
              </p>
              <p class="evidence-link">
                <a href="https://compute.tribunus.dev">
                  Architecture overview &rarr;
                </a>
              </p>
            </div>

            <div class="program-card">
              <h3>2. Governed Agents</h3>
              <p>
                Capability-scoped tool execution, approval gates for mutating
                operations, state-machine session orchestration with typed
                transitions, plugin permission boundaries, execution receipts,
                and policy enforcement. Agents operate within explicit authority
                envelopes with auditable decision paths.
              </p>
              <p class="evidence-link">
                <a href="https://docs.tribunus.dev">Documentation &rarr;</a>
              </p>
            </div>

            <div class="program-card">
              <h3>3. Local-First AI Systems</h3>
              <p>
                Running agent control planes entirely on developer hardware with
                local state, privacy-preserving execution, offline-capable
                workflows, local model backends, and user-controlled provider
                boundaries for remote inference when needed.
              </p>
            </div>

            <div class="program-card">
              <h3>4. Federated Mutual-Aid Inference (Dharma)</h3>
              <p>
                Semi-trusted peer networks for distributed inference across
                devices. Privacy-classified KV cache objects, abstracted
                transport (local IPC, LAN, QUIC, WebRTC), quorum-verified
                execution receipts, and DHT-based peer discovery with capability
                advertisements.
              </p>
              <p class="evidence-link">
                <em>Designed &mdash; research in progress</em>
              </p>
            </div>
          </section>

          <section data-component="evidence">
            <h2>Evidence registry</h2>
            <p>
              Every research claim links to an artifact: ADRs, experiment
              manifests, benchmark reports, reproducibility bundles, and
              implementation receipts.
            </p>
            <ul>
              <li>
                <a href="https://compute.tribunus.dev">
                  Compute image architecture and ADRs
                </a>{" "}
                &mdash; compile-time candidate generation, 6-check admission,
                oracle validation
              </li>
              <li>
                <a href="https://huggingface.co/datasets/Tribunus-dev/compute-kernel-evidence">
                  Compute Kernel Evidence Corpus
                </a>{" "}
                &mdash; machine-readable benchmark dataset on Hugging Face
              </li>
              <li>
                <a href="https://huggingface.co/datasets/Tribunus-dev/tribunus-benchmarks">
                  Tribunus Benchmarks
                </a>{" "}
                &mdash; curated leaderboard dataset
              </li>
              <li>
                <a href="https://github.com/tribunus-dev/tribunus/tree/dev/docs/adr">
                  Architecture Decision Records
                </a>{" "}
                &mdash; ADR 0034 through 0041 defining the compute architecture
              </li>
              <li>
                <a href="https://github.com/tribunus-dev/tribunus/tree/dev/docs/research">
                  Research notes
                </a>{" "}
                &mdash; Dharma federated inference, numerical governance,
                backend admission
              </li>
            </ul>
          </section>

          <section data-component="results">
            <h2>Current results</h2>
            <div class="result-card">
              <h3>Qwen2.5 0.5B ComputeImage</h3>
              <table>
                <tr>
                  <td>Model</td>
                  <td>Qwen2.5 0.5B</td>
                </tr>
                <tr>
                  <td>Layers</td>
                  <td>24</td>
                </tr>
                <tr>
                  <td>Tensors</td>
                  <td>556</td>
                </tr>
                <tr>
                  <td>Quantization</td>
                  <td>NF4</td>
                </tr>
                <tr>
                  <td>Primary backend</td>
                  <td>MLX Metal GPU</td>
                </tr>
                <tr>
                  <td>Fallback backend</td>
                  <td>Accelerate CPU</td>
                </tr>
                <tr>
                  <td>Verification status</td>
                  <td>Passing &mdash; oracle validated</td>
                </tr>
                <tr>
                  <td>Dataset</td>
                  <td>
                    <a href="https://huggingface.co/datasets/Tribunus-dev/compute-kernel-evidence">
                      compute-kernel-evidence
                    </a>
                  </td>
                </tr>
              </table>
            </div>
          </section>

          <section data-component="negative-results">
            <h2>Negative results</h2>
            <p>
              Not every lowering succeeds. Tribunus's credibility depends on
              recording what failed, not only what worked. The structured
              failure taxonomy covers:
            </p>
            <ul>
              <li>
                <strong>Unsupported dtype/layout</strong> &mdash; requested
                operation not realizable on target backend
              </li>
              <li>
                <strong>Compile failed</strong> &mdash; backend compiler
                rejected the candidate kernel
              </li>
              <li>
                <strong>Numerical divergence</strong> &mdash; candidate exceeded
                oracle tolerance during admission
              </li>
              <li>
                <strong>Performance regression</strong> &mdash; candidate slower
                than reference baseline
              </li>
              <li>
                <strong>Replay invalid</strong> &mdash; compute image state
                inconsistent with runtime conditions
              </li>
              <li>
                <strong>Cache-key mismatch</strong> &mdash; autotune cache key
                does not match deployment
              </li>
              <li>
                <strong>Runtime driver fault</strong> &mdash; driver/hardware
                error during kernel execution
              </li>
            </ul>
            <p>
              Each failure type is tracked in the evidence corpus with run_id,
              backend, and diagnostic context.
            </p>
          </section>

          <section data-component="open-problems">
            <h2>Open problems</h2>
            <p>
              Questions we do not yet know how to solve &mdash; and are actively
              researching:
            </p>
            <ul>
              <li>
                How to validate quantized kernels across heterogeneous backends
                without overfitting tolerance thresholds?
              </li>
              <li>
                How to make agent receipts useful for audit without exposing
                sensitive project data?
              </li>
              <li>
                How to verify federated inference across semi-trusted peers with
                minimal overhead?
              </li>
              <li>
                How to admit dynamic-shape workloads into a compile-time
                inference engine?
              </li>
              <li>
                How to handle nondeterminism in GPU drivers across different
                architectures?
              </li>
              <li>
                How to prove plugin authority boundaries in a desktop runtime at
                the OS level?
              </li>
              <li>
                How to design a tolerance matrix that is both strict enough for
                safety and permissive enough for useful inference?
              </li>
            </ul>
          </section>

          <section data-component="collaborate">
            <h2>Collaborate</h2>
            <p>We welcome collaboration across several paths:</p>
            <ul>
              <li>
                <strong>Hardware vendors</strong> &mdash; partner on backend
                admission, candidate generators, and oracle coverage for new
                architectures
              </li>
              <li>
                <strong>ML systems researchers</strong> &mdash; reproduce
                artifacts, challenge claims, extend the evidence corpus
              </li>
              <li>
                <strong>Safety researchers</strong> &mdash; help design receipt
                schemas, audit trails, and governance models for agentic systems
              </li>
              <li>
                <strong>Contributors</strong> &mdash; open issues, submit PRs,
                write ADRs, improve documentation
              </li>
              <li>
                <strong>Enterprise labs</strong> &mdash; request a technical
                briefing for deployment under your infrastructure
              </li>
            </ul>
            <p>
              <a href="https://github.com/tribunus-dev/tribunus">GitHub &rarr;</a>
              &ensp;.&ensp;
              <a href="https://docs.tribunus.dev">Docs &rarr;</a>
            </p>
          </section>
        </div>
        <Footer />
      </div>
      <Legal />
    </main>
  )
}
