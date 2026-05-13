import React, { useRef, useState } from 'react';
import {
  Viro3DObject,
  ViroAmbientLight,
  ViroARScene,
  ViroDirectionalLight,
  ViroImage,
  ViroNode,
  ViroQuad,
  ViroText,
} from '@reactvision/react-viro';

import type { CachedModelAsset, SceneModelInstance } from '../types/model';

const aimPng = require('../../assets/aim.png');

type HitTransform = {
  position?: number[];
  rotation?: number[];
  scale?: number[];
};

type ArHitResult = {
  type?: string;
  transform?: HitTransform;
};

const HIT_PRIORITY = [
  'ExistingPlaneUsingExtent',
  'ExistingPlane',
  'EstimatedHorizontalPlane',
  'DepthPoint',
  'FeaturePoint',
] as const;

function pickHitPosition(results: ArHitResult[]): [number, number, number] | null {
  if (!results?.length) {
    return null;
  }

  for (const t of HIT_PRIORITY) {
    const hit = results.find((r) => r.type === t);
    const pos = hit?.transform?.position;
    if (pos && pos.length >= 3) {
      return [pos[0], pos[1], pos[2]] as [number, number, number];
    }
  }

  const pos = results[0]?.transform?.position;
  if (pos && pos.length >= 3) {
    return [pos[0], pos[1], pos[2]] as [number, number, number];
  }

  return null;
}

type ModelPlacementSceneProps = {
  selectedModel: CachedModelAsset;
  onInitialPlanePlaced?: () => void;
  onInstanceSelected?: (instanceId: string) => void;
  onInstanceMultiToggle?: (instanceId: string) => void;
  onInstanceDragged?: (instanceId: string, x: number, y: number, z: number) => void;
  aimWorldRef?: React.MutableRefObject<[number, number, number] | null>;
  cameraForwardRef?: React.MutableRefObject<[number, number, number]>;
  sceneNavigator?: {
    viroAppProps?: {
      instances?: SceneModelInstance[];
      selectedInstanceId?: string | null;
      selectedInstanceIds?: string[];
      multiSelectMode?: boolean;
    };
  };
};

function getSurfaceOffset(model: CachedModelAsset) {
  if (typeof model.surfaceOffset === 'number') {
    return model.surfaceOffset;
  }

  if (typeof model.height === 'number' && model.height > 0) {
    return Math.max(model.height / 2, 0.05);
  }

  return 0.1;
}

export function ModelPlacementScene({
  selectedModel: _selectedModel,
  onInitialPlanePlaced,
  onInstanceSelected,
  onInstanceMultiToggle,
  onInstanceDragged,
  aimWorldRef,
  cameraForwardRef,
  sceneNavigator,
}: ModelPlacementSceneProps) {
  const trackingReadyRef = useRef(false);
  const lastReticleUiMs = useRef(0);
  const [reticlePosition, setReticlePosition] = useState<[number, number, number] | null>(null);

  const appProps = sceneNavigator?.viroAppProps;
  const instances = appProps?.instances ?? [];
  const selectedInstanceId = appProps?.selectedInstanceId ?? null;
  const selectedInstanceIds = appProps?.selectedInstanceIds ?? [];
  const multiSelectMode = appProps?.multiSelectMode ?? false;

  return (
    <ViroARScene
      anchorDetectionTypes={['PlanesHorizontal']}
      onCameraARHitTest={(event) => {
        const forward = event.cameraOrientation.forward;
        if (forward?.length === 3 && cameraForwardRef) {
          cameraForwardRef.current = [forward[0], forward[1], forward[2]];
        }

        const pos = pickHitPosition(event.hitTestResults as ArHitResult[]);
        if (aimWorldRef) {
          aimWorldRef.current = pos;
        }

        if (pos && !trackingReadyRef.current) {
          trackingReadyRef.current = true;
          onInitialPlanePlaced?.();
        }

        const now = Date.now();
        if (now - lastReticleUiMs.current > 45) {
          lastReticleUiMs.current = now;
          setReticlePosition(pos);
        }
      }}
    >
      <ViroAmbientLight color="#ffffff" intensity={900} />
      <ViroDirectionalLight color="#ffffff" direction={[0, -1, -0.2]} />

      {reticlePosition ? (
        <ViroNode position={reticlePosition}>
          <ViroImage
            source={aimPng}
            position={[0, 0.004, 0]}
            rotation={[-90, 0, 0]}
            width={0.22}
            height={0.22}
            opacity={0.95}
          />
        </ViroNode>
      ) : null}

      <ViroNode>
        {instances.map((instance) => {
          const scale = instance.scaleValue;
          const modelScale: [number, number, number] = [scale, scale, scale];
          const finalPosition: [number, number, number] = [instance.x, instance.y, instance.z];
          const floorY = instance.y - getSurfaceOffset(instance.asset);
          const indicatorPosition: [number, number, number] = [instance.x, floorY + 0.002, instance.z];
          const isPrimarySelected = selectedInstanceId === instance.instanceId;
          const isMultiSelected = selectedInstanceIds.includes(instance.instanceId);
          const isSelected = multiSelectMode ? isMultiSelected : isPrimarySelected;

          return (
            <ViroNode key={instance.instanceId}>
              {isSelected ? (
                <>
                  <ViroQuad
                    position={indicatorPosition}
                    rotation={[-90, 0, 0]}
                    width={0.36}
                    height={0.36}
                    materials="ViroARPlaneSelector_Translucent"
                  />
                  <ViroQuad
                    position={indicatorPosition}
                    rotation={[-90, 0, 0]}
                    width={0.48}
                    height={0.48}
                    opacity={0.24}
                    materials="ViroARPlaneSelector_Translucent"
                  />
                </>
              ) : null}

              <Viro3DObject
                dragType="FixedToWorld"
                onClick={() => {
                  if (multiSelectMode) {
                    onInstanceMultiToggle?.(instance.instanceId);
                    return;
                  }
                  onInstanceSelected?.(instance.instanceId);
                }}
                onDrag={(dragToPos) => {
                  onInstanceDragged?.(
                    instance.instanceId,
                    dragToPos[0],
                    dragToPos[1],
                    dragToPos[2]
                  );
                }}
                source={{ uri: instance.asset.localUri }}
                type={instance.asset.format}
                position={finalPosition}
                rotation={[0, instance.rotationY, 0]}
                scale={modelScale}
              />
            </ViroNode>
          );
        })}
      </ViroNode>

      <ViroText
        text={
          instances.length > 0
            ? multiSelectMode
              ? '多选模式：点击模型可加入/移出选集'
              : '点击模型可选中；按「放置到准星」把模型移到准星处'
            : '对准地面使准星出现，再点「放置到准星」放下模型'
        }
        position={[0, 0, -1]}
        width={2.8}
        height={0.35}
        style={{
          fontFamily: 'Arial',
          fontSize: 18,
          color: '#ffffff',
          textAlign: 'center',
          textAlignVertical: 'center',
        }}
      />
    </ViroARScene>
  );
}

export { getSurfaceOffset };
