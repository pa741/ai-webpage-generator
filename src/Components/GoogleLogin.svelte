<svelte:options
    customElement={{
        tag: "google-login",
        props: {
            label: { attribute: "label", type: "String" }
        }
    }}
/>

<script lang="ts">
    import { onMount } from "svelte";
    import {
        getAuth,
        GoogleAuthProvider,
        onAuthStateChanged,
        signInWithPopup,
        signInWithRedirect,
        connectAuthEmulator,
        signOut,
        type User
    } from "firebase/auth";
    import { app } from "$lib/firebase.js";

    let { label = "Sign in with Google" } = $props<{ label?: string }>();

    let currentUser = $state<User | null>(null);
    let loading = $state<boolean>(true);
    let errorMessage = $state<string>("");

    const auth = getAuth(app);
    connectAuthEmulator(auth, "http://localhost:9099");
    const provider = new GoogleAuthProvider();

    async function syncSessionCookie(user: User) {
        try {
            const idToken = await user.getIdToken();
            await fetch("/__session-auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ idToken })
            });
        } catch (error) {
            console.error("Failed to sync auth cookie", error);
        }
    }

    async function clearSessionCookie() {
        try {
            await fetch("/__session-auth", { method: "DELETE" });
        } catch (error) {
            console.error("Failed to clear auth cookie", error);
        }
    }

    onMount(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            currentUser = user;
            loading = false;
            if (user) {
                errorMessage = "";
                await syncSessionCookie(user);
            } else {
                await clearSessionCookie();
            }
        });

        return () => {
            unsubscribe();
        };
    });

    async function loginWithGoogle() {
        errorMessage = "";

        try {
            await signInWithPopup(auth, provider);
        } catch (error) {
            const code =
                typeof error === "object" &&
                error !== null &&
                "code" in error &&
                typeof (error as { code?: unknown }).code === "string"
                    ? (error as { code: string }).code
                    : "";

            const shouldUseRedirect =
                code === "auth/popup-blocked" ||
                code === "auth/popup-closed-by-user" ||
                code === "auth/cancelled-popup-request";

            if (shouldUseRedirect) {
                await signInWithRedirect(auth, provider);
                return;
            }

            errorMessage =
                error instanceof Error
                    ? error.message
                    : "Google sign-in failed. Please try again.";
        }
    }

    async function logoutFromGoogle() {
        try {
            await signOut(auth);
        } catch (error) {
            errorMessage =
                error instanceof Error
                    ? error.message
                    : "Sign-out failed. Please try again.";
        }
    }
</script>

{#if !loading && !currentUser}
    <div class="google-login">
        <button type="button" class="fab" onclick={loginWithGoogle} aria-label={label}>
            <span class="google-mark" aria-hidden="true">G</span>
        </button>
        {#if errorMessage}
            <p class="google-error">{errorMessage}</p>
        {/if}
    </div>
{/if}

<style>
    .google-login {
        position: fixed;
        bottom: 1.25rem;
        left: 1.25rem;
        z-index: 50;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.5rem;
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    }

    .fab {
        width: 3.25rem;
        height: 3.25rem;
        border-radius: 9999px;
        border: none;
        background: #1f2937;
        color: #f9fafb;
        font-size: 1.1rem;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 120ms ease, background-color 120ms ease;
    }

    .fab:hover {
        background: #111827;
        transform: translateY(-2px);
    }

    .google-mark {
        font-size: 1.1rem;
        font-weight: 700;
        line-height: 1;
    }

    .google-error {
        background: #fff;
        border: 1px solid #fca5a5;
        border-radius: 0.5rem;
        color: #b91c1c;
        font-size: 0.78rem;
        line-height: 1.3;
        margin: 0;
        max-width: 14rem;
        padding: 0.4rem 0.6rem;
    }
</style>
