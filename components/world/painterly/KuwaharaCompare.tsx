"use client";

import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import * as THREE from "three";

const kuwaharaShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTexel: { value: new THREE.Vector2(1, 1) },
    uStrength: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform vec2 uTexel;
    uniform float uStrength;

    vec3 sectorMean(vec2 direction, out float variance) {
      vec3 mean = vec3(0.0);
      vec3 squareMean = vec3(0.0);
      for (int x = 0; x < 2; x++) {
        for (int y = 0; y < 2; y++) {
          vec2 offset = direction * (vec2(float(x), float(y)) + 0.5) * uTexel * 1.35;
          vec3 sampleColor = texture2D(tDiffuse, vUv + offset).rgb;
          mean += sampleColor;
          squareMean += sampleColor * sampleColor;
        }
      }
      mean *= 0.25;
      squareMean *= 0.25;
      vec3 channelVariance = max(squareMean - mean * mean, vec3(0.0));
      variance = dot(channelVariance, vec3(0.299, 0.587, 0.114));
      return mean;
    }

    void main() {
      float variance;
      float bestVariance;
      vec3 best = sectorMean(vec2(-1.0, -1.0), bestVariance);

      vec3 candidate = sectorMean(vec2(1.0, -1.0), variance);
      if (variance < bestVariance) {
        best = candidate;
        bestVariance = variance;
      }
      candidate = sectorMean(vec2(-1.0, 1.0), variance);
      if (variance < bestVariance) {
        best = candidate;
        bestVariance = variance;
      }
      candidate = sectorMean(vec2(1.0, 1.0), variance);
      if (variance < bestVariance) best = candidate;

      vec4 source = texture2D(tDiffuse, vUv);
      gl_FragColor = vec4(mix(source.rgb, best, uStrength), source.a);
    }
  `,
};

export function KuwaharaCompare({ strength }: { strength: number }) {
  const { camera, gl, scene, size } = useThree();
  const { composer, shaderPass } = useMemo(() => {
    const composer = new EffectComposer(gl);
    composer.addPass(new RenderPass(scene, camera));
    const shaderPass = new ShaderPass(kuwaharaShader);
    composer.addPass(shaderPass);
    composer.addPass(new OutputPass());
    return { composer, shaderPass };
  }, [camera, gl, scene]);

  useEffect(() => {
    composer.setSize(size.width, size.height);
    const texel = shaderPass.uniforms.uTexel?.value;
    if (!(texel instanceof THREE.Vector2)) throw new Error("Kuwahara shader is missing its texel-size uniform.");
    texel.set(1 / (size.width * gl.getPixelRatio()), 1 / (size.height * gl.getPixelRatio()));
  }, [composer, gl, shaderPass, size.height, size.width]);

  useEffect(() => {
    const strengthUniform = shaderPass.uniforms.uStrength;
    if (!strengthUniform) throw new Error("Kuwahara shader is missing its strength uniform.");
    strengthUniform.value = strength;
  }, [shaderPass, strength]);

  useEffect(
    () => () => {
      composer.passes.forEach((pass) => pass.dispose());
      composer.dispose();
    },
    [composer],
  );

  useFrame((_, delta) => composer.render(delta), 1);
  return null;
}
