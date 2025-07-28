<svelte:options
    customElement={{
        tag: "three-canvas",
        props: {
            description: { attribute: "description", type: "String" },
        },
    }}
/>

<script lang="ts">
    import { getFunctions, httpsCallable } from "firebase/functions";
    import { app } from "$lib/firebase.js";
    import { onMount } from "svelte";

    const functions = getFunctions(app, "europe-southwest1");
    const createScene = httpsCallable<
        {
            description: string;
        },
        { script: string }
    >(functions, "createScene");
    let canvasElement: HTMLCanvasElement;
    let { description } = $props();

    onMount(() => {
        if (description && canvasElement) {
            runDynamicScene(description);
        }
    });

    async function runDynamicScene(desc: string) {
        console.log("Generating scene for description:", desc);
        const { data } = await createScene({ description: desc });
        const scriptString = `
        import * as THREE from "three";
        import { OrbitControls } from "three-orbitcontrols";
        export default function main(canvas)
        {
            const renderer = new THREE.WebGLRenderer({antialias: true, canvas});

            ${data.script
            .replaceAll("document.body.appendChild(renderer.domElement);","")
            .replaceAll("THREE.OrbitControls","OrbitControls")
            }
        }
       `;
       console.log("Generated script:", scriptString);

        // 1. Create a Blob from the script string
        const blob = new Blob([scriptString], { type: "text/javascript" });

        // 2. Create a temporary URL for the Blob
        const url = URL.createObjectURL(blob);

        try {
            // 3. Dynamically import the module from the Blob URL
            const sceneModule = await import(url);

            // Run the default exported function from your module
            if (
                sceneModule.default &&
                typeof sceneModule.default === "function"
            ) {
                sceneModule.default(canvasElement);
            }
        } catch (error) {
            console.error("Error executing dynamic scene script:", error);
        } finally {
            // 4. Clean up the URL to prevent memory leaks
            URL.revokeObjectURL(url);
        }
    }

    // add random id
    const randomId = Math.random().toString(36).substring(2, 15);
    const canvasId = `canvas-${randomId}`;
</script>

<div>
    <canvas bind:this={canvasElement} id={canvasId} class="three-canvas"
    ></canvas>
</div>
