<svelte:options
    customElement={{
        tag: "feedback-fab",
        props: {}
    }}
/>

<script lang="ts">
    import { onMount } from "svelte";
    import { getAuth, onAuthStateChanged, type User } from "firebase/auth";
    import { getFunctions, httpsCallable, connectFunctionsEmulator } from "firebase/functions";
    import { app } from "$lib/firebase.js";

    interface FeedbackAction {
        kind: string;
        text?: string;
        id?: string;
        reason?: string;
    }

    interface FeedbackResult {
        summary: string;
        actions: FeedbackAction[];
    }

    let currentUser = $state<User | null>(null);
    let modalOpen = $state(false);
    let feedback = $state("");
    let submitting = $state(false);
    let resultMessage = $state("");
    let errorMessage = $state("");

    const auth = getAuth(app);
    const functions = getFunctions(app, "europe-southwest1");

    if (typeof window !== "undefined" && window.location.hostname === "localhost") {
        try {
            connectFunctionsEmulator(functions, "localhost", 5001);
        } catch {
            // already connected
        }
    }

    const evaluateFeedback = httpsCallable<{ feedback: string }, FeedbackResult>(functions, "evaluateFeedback");

    onMount(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            currentUser = user;
        });
        return () => unsubscribe();
    });

    function openModal() {
        modalOpen = true;
        resultMessage = "";
        errorMessage = "";
    }

    function closeModal() {
        if (submitting) return;
        modalOpen = false;
        feedback = "";
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Escape" && modalOpen) {
            closeModal();
        }
    }

    async function submitFeedback() {
        const text = feedback.trim();
        if (!text || submitting) return;

        submitting = true;
        errorMessage = "";
        resultMessage = "";

        try {
            const response = await evaluateFeedback({ feedback: text });
            resultMessage = response.data?.summary ?? "Feedback received.";
            feedback = "";
        } catch (error) {
            errorMessage = error instanceof Error ? error.message : "Could not submit feedback.";
        } finally {
            submitting = false;
        }
    }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if currentUser}
    <button
        type="button"
        class="fab"
        aria-label="Open feedback"
        onclick={openModal}
    >
        <span aria-hidden="true">💬</span>
    </button>

    {#if modalOpen}
        <div
            class="backdrop"
            role="presentation"
            onclick={closeModal}
        ></div>
        <div class="modal" role="dialog" aria-modal="true" aria-label="Submit feedback">
            <h2 class="title">How should this site behave or look?</h2>
            <p class="hint">Tell us a preference (e.g. "use Spanish text", "make cards more compact", "add a dark theme").</p>
            <textarea
                class="textarea"
                bind:value={feedback}
                placeholder="Describe your preference..."
                rows="4"
                disabled={submitting}
            ></textarea>
            <div class="actions">
                <button
                    type="button"
                    class="cancel"
                    onclick={closeModal}
                    disabled={submitting}
                >
                    Cancel
                </button>
                <button
                    type="button"
                    class="submit"
                    onclick={submitFeedback}
                    disabled={submitting || feedback.trim().length === 0}
                >
                    {submitting ? "Sending…" : "Send"}
                </button>
            </div>
            {#if resultMessage}
                <p class="result">{resultMessage}</p>
            {/if}
            {#if errorMessage}
                <p class="error">{errorMessage}</p>
            {/if}
        </div>
    {/if}
{/if}

<style>
    .fab {
        position: fixed;
        bottom: 1.25rem;
        left: 1.25rem;
        width: 3.25rem;
        height: 3.25rem;
        border-radius: 9999px;
        border: none;
        background: #1f2937;
        color: #f9fafb;
        font-size: 1.4rem;
        cursor: pointer;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 50;
        transition: transform 120ms ease, background-color 120ms ease;
    }

    .fab:hover {
        background: #111827;
        transform: translateY(-2px);
    }

    .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.4);
        z-index: 60;
    }

    .modal {
        position: fixed;
        bottom: 5.5rem;
        left: 1.25rem;
        width: min(22rem, calc(100vw - 2rem));
        background: #ffffff;
        color: #111827;
        border-radius: 0.75rem;
        padding: 1rem 1.25rem 1.25rem;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.25);
        z-index: 70;
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    }

    .title {
        margin: 0 0 0.25rem;
        font-size: 1rem;
        font-weight: 600;
    }

    .hint {
        margin: 0 0 0.75rem;
        font-size: 0.8rem;
        color: #4b5563;
        line-height: 1.3;
    }

    .textarea {
        width: 100%;
        border: 1px solid #d1d5db;
        border-radius: 0.5rem;
        padding: 0.5rem 0.65rem;
        font-size: 0.9rem;
        font-family: inherit;
        resize: vertical;
        box-sizing: border-box;
    }

    .textarea:focus {
        outline: 2px solid #2563eb;
        outline-offset: 1px;
        border-color: transparent;
    }

    .actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
        margin-top: 0.75rem;
    }

    .cancel,
    .submit {
        border-radius: 9999px;
        border: 1px solid transparent;
        font-size: 0.85rem;
        font-weight: 600;
        padding: 0.4rem 0.95rem;
        cursor: pointer;
        transition: background-color 120ms ease, border-color 120ms ease;
    }

    .cancel {
        background: transparent;
        border-color: #d1d5db;
        color: #374151;
    }

    .cancel:hover:not(:disabled) {
        background: #f3f4f6;
    }

    .submit {
        background: #1f2937;
        color: #f9fafb;
    }

    .submit:hover:not(:disabled) {
        background: #111827;
    }

    .submit:disabled,
    .cancel:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .result {
        margin: 0.75rem 0 0;
        font-size: 0.8rem;
        color: #047857;
        line-height: 1.3;
    }

    .error {
        margin: 0.75rem 0 0;
        font-size: 0.8rem;
        color: #b91c1c;
        line-height: 1.3;
    }
</style>
