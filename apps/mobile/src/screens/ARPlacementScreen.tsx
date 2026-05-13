import * as MediaLibrary from 'expo-media-library'; 
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  PanResponder,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ViroARSceneNavigator } from '@reactvision/react-viro';

import { ModelPlacementScene, getSurfaceOffset } from '../scenes/ModelPlacementScene';
import { cacheModelAsset } from '../services/modelCache';
import {
  buildSavedSceneDocument,
  loadRecentScene,
  saveRecentScene,
} from '../services/sceneStorage';
import {
  createSyncService,
  destroySharedSyncService,
  initSharedSyncService,
} from '../services/syncService';
import type { CachedModelAsset, RemoteModel, SceneModelInstance } from '../types/model';
import type { SavedSceneDocument } from '../types/scene';
import type { SyncConnectionStatus, SyncMessage, SyncServiceConfig } from '../types/sync';
 
type ARPlacementScreenProps = {
  // retried-success
  initialModel: CachedModelAsset;
  availableModels: RemoteModel[];
  onBack: () => void;
  /** 可选：传入后自动建立 WebSocket 同步连接，推送场景状态至电脑端 */
  syncConfig?: SyncServiceConfig;
};

export function ARPlacementScreen({
  initialModel,
  availableModels,
  onBack,
  syncConfig,
}: ARPlacementScreenProps) {
  const topSafeOffset = (StatusBar.currentHeight ?? 0) + 12;
  const arNavigatorRef = useRef<ViroARSceneNavigator | null>(null);
  const aimWorldRef = useRef<[number, number, number] | null>(null);
  const cameraForwardRef = useRef<[number, number, number]>([0, 0, -1]);
  const [placementSession, setPlacementSession] = useState(0);
  const [sceneReady, setSceneReady] = useState(false);
  const [instances, setInstances] = useState<SceneModelInstance[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [cachedAssets, setCachedAssets] = useState<Record<string, CachedModelAsset>>({
    [initialModel.id]: initialModel,
  });
  const [pendingAsset, setPendingAsset] = useState<CachedModelAsset>(initialModel);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [preparingModelId, setPreparingModelId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [captureMessage, setCaptureMessage] = useState<string | null>(null);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [topPanelCollapsed, setTopPanelCollapsed] = useState(false);
  const [sensitivityCollapsedSide, setSensitivityCollapsedSide] = useState<'left' | 'right' | null>(null);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedInstanceIds, setSelectedInstanceIds] = useState<string[]>([]);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState<'photo' | 'video' | null>(null);
  const [moveStick, setMoveStick] = useState({ x: 0, y: 0 });
  const [rotateStick, setRotateStick] = useState({ x: 0, y: 0 });
  const [recentSceneMeta, setRecentSceneMeta] = useState<SavedSceneDocument | null>(null);
  const [restoringScene, setRestoringScene] = useState(false);

  // ── 双端同步状态 ────────────────────────────────────────────────
  const [syncStatus, setSyncStatus] = useState<SyncConnectionStatus>('disconnected');
  const syncServiceRef = useRef<ReturnType<typeof createSyncService> | null>(null);

  // 初始化 / 清理 syncService
  React.useEffect(() => {
    if (!syncConfig) return;
    const svc = initSharedSyncService(syncConfig);
    syncServiceRef.current = svc;
    const unsubStatus = svc.onStatusChange((s) => setSyncStatus(s));
    const unsubMsg = svc.onMessage((msg: SyncMessage) => {
      if (msg.type === 'pong') return;
      
      // 处理来自电脑端的模型更新
      if (msg.type === 'instance_update') {
        const remoteInstance = msg.instance;
        setInstances((current) =>
          current.map((item) =>
            item.instanceId === remoteInstance.instanceId
              ? { ...item, ...remoteInstance, asset: item.asset } // 保留本地缓存资产，仅同步位姿与锁状态
              : item
          )
        );
        return;
      }

      if (msg.type === 'lock_acquire' || msg.type === 'lock_release') {
        // TODO: 后续可以在 UI 上显示模型被电脑锁定的状态
        return;
      }
    });
    svc.connect();
    return () => {
      unsubStatus();
      unsubMsg();
      destroySharedSyncService();
      syncServiceRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncConfig?.serverUrl, syncConfig?.sessionId]);

  // instances 或 selectedInstanceId 变化时记录最新快照；连接可用时会立即发送，连接恢复后会自动补发
  React.useEffect(() => {
    const svc = syncServiceRef.current;
    if (!svc) return;
    svc.pushSnapshot(instances, selectedInstanceId);
  }, [instances, selectedInstanceId]);

  React.useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const recentScene = await loadRecentScene();
        if (active) {
          setRecentSceneMeta(recentScene);
        }
      } catch {
        if (active) {
          setRecentSceneMeta(null);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);
  // ────────────────────────────────────────────────────────────────

  const selectedInstance = useMemo(
    () => instances.find((item) => item.instanceId === selectedInstanceId) ?? null,
    [instances, selectedInstanceId]
  );

  const joystickRadius = 36;
  const [joystickMoveSpeed, setJoystickMoveSpeed] = useState(0.035);
  const [joystickRotateSpeed, setJoystickRotateSpeed] = useState(3.5);

  const updateSelectedPositionByJoystick = useCallback((normX: number, normY: number) => {
    if (!selectedInstanceId) {
      return;
    }

    const [fx, , fz] = cameraForwardRef.current;
    const lenH = Math.hypot(fx, fz);
    let fhx = fx;
    let fhz = fz;
    if (lenH < 0.06) {
      fhx = 0;
      fhz = -1;
    } else {
      fhx = fx / lenH;
      fhz = fz / lenH;
    }

    const rightX = -fhz;
    const rightZ = fhx;
    const speed = joystickMoveSpeed;
    const ddx = (rightX * normX + fhx * (-normY)) * speed;
    const ddz = (rightZ * normX + fhz * (-normY)) * speed;

    setInstances((current) =>
      current.map((item) => {
        if (item.instanceId !== selectedInstanceId) {
          return item;
        }

        return {
          ...item,
          x: Number((item.x + ddx).toFixed(2)),
          z: Number((item.z + ddz).toFixed(2)),
        };
      })
    );
  }, [joystickMoveSpeed, selectedInstanceId]);

  const updateSelectedRotationByJoystick = useCallback((dxNorm: number) => {
    if (!selectedInstanceId) {
      return;
    }

    setInstances((current) =>
      current.map((item) => {
        if (item.instanceId !== selectedInstanceId) {
          return item;
        }

        const next = item.rotationY + dxNorm * joystickRotateSpeed;
        return {
          ...item,
          rotationY: Number((((next % 360) + 360) % 360).toFixed(1)),
        };
      })
    );
  }, [joystickRotateSpeed, selectedInstanceId]);

  const moveStickResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          if (!selectedInstanceId) {
            Alert.alert('请先选中模型', '摇杆控制前请先点击一个模型实例。');
          }
        },
        onPanResponderMove: (_, gestureState) => {
          const dx = gestureState.dx;
          const dy = gestureState.dy;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const limited = distance > joystickRadius ? joystickRadius / distance : 1;
          const nextX = Number((dx * limited).toFixed(1));
          const nextY = Number((dy * limited).toFixed(1));
          setMoveStick({ x: nextX, y: nextY });

          const normX = nextX / joystickRadius;
          const normY = nextY / joystickRadius;
          updateSelectedPositionByJoystick(normX, normY);
        },
        onPanResponderRelease: () => {
          setMoveStick({ x: 0, y: 0 });
        },
        onPanResponderTerminate: () => {
          setMoveStick({ x: 0, y: 0 });
        },
      }),
    [selectedInstanceId, updateSelectedPositionByJoystick]
  );

  const rotateStickResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          if (!selectedInstanceId) {
            Alert.alert('请先选中模型', '摇杆控制前请先点击一个模型实例。');
          }
        },
        onPanResponderMove: (_, gestureState) => {
          const dx = gestureState.dx;
          const dy = gestureState.dy;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const limited = distance > joystickRadius ? joystickRadius / distance : 1;
          const nextX = Number((dx * limited).toFixed(1));
          const nextY = Number((dy * limited).toFixed(1));
          setRotateStick({ x: nextX, y: nextY });

          const normX = nextX / joystickRadius;
          updateSelectedRotationByJoystick(normX);
        },
        onPanResponderRelease: () => {
          setRotateStick({ x: 0, y: 0 });
        },
        onPanResponderTerminate: () => {
          setRotateStick({ x: 0, y: 0 });
        },
      }),
    [selectedInstanceId, updateSelectedRotationByJoystick]
  );

  const tuneMoveSpeed = useCallback((delta: number) => {
    setJoystickMoveSpeed((value) =>
      Number(Math.max(0.005, Math.min(0.08, value + delta)).toFixed(3))
    );
  }, []);

  const tuneRotateSpeed = useCallback((delta: number) => {
    setJoystickRotateSpeed((value) =>
      Number(Math.max(0.5, Math.min(10, value + delta)).toFixed(1))
    );
  }, []);

  const createInstanceId = useCallback(() => {
    return `instance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }, []);

  const createSceneInstance = useCallback(
    (
      asset: CachedModelAsset,
      position: { x: number; z: number; floorY: number },
      overrides?: Partial<Pick<SceneModelInstance, 'instanceId' | 'y' | 'rotationY' | 'scaleValue'>>
    ): SceneModelInstance => {
      return {
        instanceId: overrides?.instanceId ?? createInstanceId(),
        asset,
        x: position.x,
        z: position.z,
        y: overrides?.y ?? position.floorY + getSurfaceOffset(asset),
        rotationY: overrides?.rotationY ?? 0,
        scaleValue: overrides?.scaleValue ?? asset.defaultScale ?? 1,
      };
    },
    [createInstanceId]
  );

  const resetPlacement = useCallback(() => {
    setSceneReady(false);
    setInstances([]);
    setSelectedInstanceId(null);
    setSelectedInstanceIds([]);
    setMultiSelectMode(false);
    setPendingAsset(initialModel);
    setShowModelPicker(false);
    setCaptureMessage(null);
    setPlacementSession((value) => value + 1);
  }, [initialModel]);

  const adjustHeight = useCallback((delta: number) => {
    setInstances((current) =>
      current.map((item) =>
        item.instanceId === selectedInstanceId
          ? {
              ...item,
              y: Number(Math.max(0.02, item.y + delta).toFixed(2)),
            }
          : item
      )
    );
  }, [selectedInstanceId]);

  const adjustScale = useCallback((delta: number) => {
    setInstances((current) =>
      current.map((item) =>
        item.instanceId === selectedInstanceId
          ? {
              ...item,
              scaleValue: Number(Math.max(0.01, item.scaleValue + delta).toFixed(2)),
            }
          : item
      )
    );
  }, [selectedInstanceId]);

  const adjustRotation = useCallback((delta: number) => {
    setInstances((current) =>
      current.map((item) => {
        if (item.instanceId !== selectedInstanceId) {
          return item;
        }

        const next = item.rotationY + delta;
        return {
          ...item,
          rotationY: ((next % 360) + 360) % 360,
        };
      })
    );
  }, [selectedInstanceId]);

  const handleInitialPlanePlaced = useCallback(() => {
    setSceneReady(true);
  }, []);

  const handleInstanceSelected = useCallback((instanceId: string) => {
    setSelectedInstanceId(instanceId);
    if (!multiSelectMode) {
      setSelectedInstanceIds([instanceId]);
    }
  }, [multiSelectMode]);

  const handleInstanceMultiToggle = useCallback((instanceId: string) => {
    setSelectedInstanceId(instanceId);
    setSelectedInstanceIds((current) =>
      current.includes(instanceId)
        ? current.filter((id) => id !== instanceId)
        : [...current, instanceId]
    );
  }, []);

  const handleToggleMultiSelectMode = useCallback(() => {
    setMultiSelectMode((prev) => {
      const next = !prev;

      if (!next) {
        setSelectedInstanceIds(selectedInstanceId ? [selectedInstanceId] : []);
      } else if (selectedInstanceId) {
        setSelectedInstanceIds((current) =>
          current.includes(selectedInstanceId) ? current : [...current, selectedInstanceId]
        );
      }

      return next;
    });
  }, [selectedInstanceId]);

  const handleClearMultiSelection = useCallback(() => {
    setSelectedInstanceIds(selectedInstanceId ? [selectedInstanceId] : []);
  }, [selectedInstanceId]);

  const handleSelectNearby = useCallback(() => {
    if (!selectedInstanceId) {
      Alert.alert('请先选中一个模型', '框选附近会基于当前选中模型位置进行范围选择。');
      return;
    }

    const center = instances.find((item) => item.instanceId === selectedInstanceId);
    if (!center) {
      return;
    }

    const radius = 0.4;
    const picked = instances
      .filter((item) => {
        const dx = item.x - center.x;
        const dz = item.z - center.z;
        return Math.sqrt(dx * dx + dz * dz) <= radius;
      })
      .map((item) => item.instanceId);

    setSelectedInstanceIds(picked);
  }, [instances, selectedInstanceId]);

  const handleInstanceDragged = useCallback(
    (instanceId: string, x: number, y: number, z: number) => {
      setInstances((current) =>
        current.map((item) =>
          item.instanceId === instanceId
            ? {
                ...item,
                x: Number(x.toFixed(2)),
                y: Number(y.toFixed(2)),
                z: Number(z.toFixed(2)),
              }
            : item
        )
      );
    },
    []
  );

  const addInstanceToScene = useCallback(
    (asset: CachedModelAsset) => {
      const aim = aimWorldRef.current;
      if (!aim) {
        Alert.alert('请先对准平面', '移动手机使准星落在地面或桌面上，再添加模型。');
        return;
      }

      setInstances((current) => {
        const nextInstance = createSceneInstance(asset, {
          x: aim[0],
          z: aim[2],
          floorY: aim[1],
        });
        setSelectedInstanceId(nextInstance.instanceId);
        setSelectedInstanceIds((currentIds) =>
          multiSelectMode ? [...currentIds, nextInstance.instanceId] : [nextInstance.instanceId]
        );
        return [...current, nextInstance];
      });
    },
    [createSceneInstance, multiSelectMode]
  );

  const handlePlaceAtAim = useCallback(() => {
    const aim = aimWorldRef.current;
    if (!aim) {
      Alert.alert('没有准星落点', '请先缓慢平移手机，让准星出现在地面或桌面上。');
      return;
    }

    if (instances.length === 0) {
      const inst = createSceneInstance(pendingAsset, {
        x: aim[0],
        z: aim[2],
        floorY: aim[1],
      });
      setInstances([inst]);
      setSelectedInstanceId(inst.instanceId);
      setSelectedInstanceIds([inst.instanceId]);
      return;
    }

    if (!selectedInstanceId) {
      Alert.alert('请先选中模型', '在场景中点击要移动的模型，再使用「放置到准星」。');
      return;
    }

    setInstances((current) =>
      current.map((item) => {
        if (item.instanceId !== selectedInstanceId) {
          return item;
        }
        const floorY = aim[1];
        return {
          ...item,
          x: aim[0],
          z: aim[2],
          y: floorY + getSurfaceOffset(item.asset),
        };
      })
    );
  }, [createSceneInstance, instances.length, pendingAsset, selectedInstanceId]);

  const handleAddCurrentModel = useCallback(() => {
    if (!sceneReady) {
      Alert.alert('请先放置第一个模型', '先扫描平面并放下第一个模型，才能继续添加。');
      return;
    }

    addInstanceToScene(pendingAsset);
  }, [addInstanceToScene, pendingAsset, sceneReady]);

  const handleChooseModel = useCallback(
    async (model: RemoteModel) => {
      try {
        setPreparingModelId(model.id);

        const readyAsset =
          cachedAssets[model.id] ?? (await cacheModelAsset(model));

        setCachedAssets((current) => ({
          ...current,
          [readyAsset.id]: readyAsset,
        }));
        setPendingAsset(readyAsset);
        setShowModelPicker(false);

        if (sceneReady) {
          addInstanceToScene(readyAsset);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : '模型加载失败，请稍后重试。';
        Alert.alert('模型加载失败', message);
      } finally {
        setPreparingModelId(null);
      }
    },
    [addInstanceToScene, cachedAssets, sceneReady]
  );

  const handleDeleteSelected = useCallback(() => {
    const deleteIds =
      multiSelectMode && selectedInstanceIds.length > 0
        ? selectedInstanceIds
        : selectedInstanceId
          ? [selectedInstanceId]
          : [];

    if (deleteIds.length === 0) {
      Alert.alert('请先选中模型', '点击场景中的模型后，再执行删除。');
      return;
    }

    const remaining = instances.filter((item) => !deleteIds.includes(item.instanceId));
    setInstances(remaining);

    const fallback = remaining[remaining.length - 1]?.instanceId ?? null;
    setSelectedInstanceId(fallback);
    setSelectedInstanceIds(fallback ? [fallback] : []);
  }, [instances, multiSelectMode, selectedInstanceId, selectedInstanceIds]);

  const handleSaveScene = useCallback(async () => {
    if (instances.length === 0) {
      Alert.alert('当前没有可保存内容', '请先在场景中放置至少一个模型。');
      return;
    }

    try {
      const document = buildSavedSceneDocument(
        instances,
        selectedInstanceId,
        pendingAsset.id
      );
      await saveRecentScene(document);
      setRecentSceneMeta(document);
      const message = `最近场景已保存，共 ${document.instances.length} 个模型。`;
      setCaptureMessage(message);
      Alert.alert('场景已保存', message);
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存场景失败，请稍后重试。';
      Alert.alert('保存失败', message);
    }
  }, [instances, pendingAsset.id, selectedInstanceId]);

  const handleRestoreRecentScene = useCallback(async () => {
    try {
      setRestoringScene(true);
      const savedScene = await loadRecentScene();

      if (!savedScene || savedScene.instances.length === 0) {
        Alert.alert('没有可恢复的场景', '请先保存一次场景，再尝试恢复。');
        return;
      }

      const restoredAssets = { ...cachedAssets };
      const restoredInstances: SceneModelInstance[] = [];

      for (const savedInstance of savedScene.instances) {
        const remoteModel = availableModels.find((item) => item.id === savedInstance.modelId);
        if (!remoteModel) {
          throw new Error(`模型 ${savedInstance.modelId} 不在当前模型列表中，无法恢复。`);
        }

        const asset = restoredAssets[remoteModel.id] ?? (await cacheModelAsset(remoteModel));
        restoredAssets[asset.id] = asset;

        restoredInstances.push(
          createSceneInstance(
            asset,
            {
              x: savedInstance.x,
              z: savedInstance.z,
              floorY: savedInstance.y - getSurfaceOffset(asset),
            },
            {
              instanceId: savedInstance.instanceId,
              y: savedInstance.y,
              rotationY: savedInstance.rotationY,
              scaleValue: savedInstance.scaleValue,
            }
          )
        );
      }

      const restoredPendingAsset =
        (savedScene.pendingModelId ? restoredAssets[savedScene.pendingModelId] : null) ??
        restoredInstances[0]?.asset ??
        initialModel;

      setCachedAssets(restoredAssets);
      setInstances(restoredInstances);
      setSelectedInstanceId(savedScene.selectedInstanceId ?? restoredInstances[0]?.instanceId ?? null);
      setSelectedInstanceIds(
        savedScene.selectedInstanceId ? [savedScene.selectedInstanceId] : restoredInstances[0] ? [restoredInstances[0].instanceId] : []
      );
      setPendingAsset(restoredPendingAsset);
      setSceneReady(restoredInstances.length > 0);
      setMultiSelectMode(false);
      setShowModelPicker(false);
      setRecentSceneMeta(savedScene);
      setPlacementSession((value) => value + 1);
      setCaptureMessage(`已恢复最近场景，共 ${restoredInstances.length} 个模型。`);
      Alert.alert('恢复成功', `已恢复最近场景，共 ${restoredInstances.length} 个模型。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '恢复场景失败，请稍后重试。';
      Alert.alert('恢复失败', message);
    } finally {
      setRestoringScene(false);
    }
  }, [availableModels, cachedAssets, createSceneInstance, initialModel]);

  const requirePlacedModel = useCallback(() => {
    if (instances.length === 0) {
      Alert.alert('请先放置模型', '先扫描平面并点击放置模型，再进行拍照或录像。');
      return false;
    }

    return true;
  }, [instances.length]);

  const createCaptureFileName = useCallback((prefix: 'photo' | 'video') => {
    return `${prefix}-${Date.now()}`;
  }, []);

  // 请求相册写入权限，返回是否已授权
  const requestMediaPermission = useCallback(async (): Promise<boolean> => {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('需要相册权限', '请在系统设置中允许访问相册，才能保存照片和视频。');
      return false;
    }
    return true;
  }, []);

  // 将文件保存到「Manga AR」相册
  const saveToMediaLibrary = useCallback(async (fileUri: string, type: 'photo' | 'video') => {
    try {
      const asset = await MediaLibrary.createAssetAsync(fileUri);
      let album = await MediaLibrary.getAlbumAsync('Manga AR');
      if (!album) {
        await MediaLibrary.createAlbumAsync('Manga AR', asset, false);
      } else {
        await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
      }
      const label = type === 'photo' ? '照片' : '视频';
      const msg = `${label}已保存到相册「Manga AR」`;
      setCaptureMessage(msg);
      Alert.alert(`${label}已保存`, msg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存到相册失败，请稍后重试。';
      setCaptureMessage(msg);
      Alert.alert('保存失败', msg);
    }
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreviewVisible(false);
    setPreviewUri(null);
    setPreviewType(null);
  }, []);

  const handleSavePreview = useCallback(async () => {
    if (!previewUri || !previewType) {
      handleClosePreview();
      return;
    }

    await saveToMediaLibrary(previewUri, previewType);
    handleClosePreview();
  }, [handleClosePreview, previewType, previewUri, saveToMediaLibrary]);

  const handleDiscardPreview = useCallback(() => {
    setCaptureMessage('已放弃当前拍摄结果');
    handleClosePreview();
  }, [handleClosePreview]);

  const handleTakePhoto = useCallback(async () => {
    if (!requirePlacedModel()) return;

    const hasPermission = await requestMediaPermission();
    if (!hasPermission) return;

    const navigator = arNavigatorRef.current;
    if (!navigator?._takeScreenshot) {
      Alert.alert('拍照不可用', '当前 AR 视图还没有准备好，请稍后重试。');
      return;
    }

    try {
      setCaptureMessage('正在生成截图...');
      const result = await navigator._takeScreenshot(createCaptureFileName('photo'), false);

      if (result?.success && result.url) {
        setPreviewUri(result.url);
        setPreviewType('photo');
        setPreviewVisible(true);
        setCaptureMessage('截图完成，请先预览再决定是否保存。');
        return;
      }

      const failureMessage = `截图失败，错误码：${result?.errorCode ?? 'unknown'}`;
      setCaptureMessage(failureMessage);
      Alert.alert('拍照失败', failureMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : '截图失败，请稍后重试。';
      setCaptureMessage(message);
      Alert.alert('拍照失败', message);
    }
  }, [createCaptureFileName, requestMediaPermission, requirePlacedModel]);

  const handleStartRecording = useCallback(async () => {
    if (!requirePlacedModel()) {
      return;
    }

    const hasPermission = await requestMediaPermission();
    if (!hasPermission) {
      return;
    }

    const navigator = arNavigatorRef.current as
      | (ViroARSceneNavigator & {
          _startVideoRecording?: (
            fileName: string,
            saveToCameraRoll: boolean,
            onError: (errorCode: number) => void
          ) => void;
        })
      | null;

    if (!navigator?._startVideoRecording) {
      Alert.alert('录像不可用', '当前 AR 视图还没有准备好，请稍后重试。');
      return;
    }

    navigator._startVideoRecording(
      createCaptureFileName('video'),
      false,
      (errorCode: number) => {
        setIsRecording(false);
        const message = `录像启动失败，错误码：${errorCode}`;
        setCaptureMessage(message);
        Alert.alert('录像失败', message);
      }
    );

    setIsRecording(true);
    setCaptureMessage('正在录像中...');
  }, [createCaptureFileName, requestMediaPermission, requirePlacedModel]);

  const handleStopRecording = useCallback(async () => {
    const navigator = arNavigatorRef.current as
      | (ViroARSceneNavigator & {
          _stopVideoRecording?: () => Promise<{
            success?: boolean;
            url?: string;
            errorCode?: number;
          }>;
        })
      | null;

    if (!navigator?._stopVideoRecording) {
      Alert.alert('录像不可用', '当前 AR 视图还没有准备好，请稍后重试。');
      return;
    }

    try {
      setCaptureMessage('正在结束录像...');
      const result = await navigator._stopVideoRecording();
      setIsRecording(false);

      if (result?.success && result.url) {
        setPreviewUri(result.url);
        setPreviewType('video');
        setPreviewVisible(true);
        setCaptureMessage('录像完成，请先预览再决定是否保存。');
        return;
      }

      if (result?.success) {
        const message = '录像完成，但未返回可保存文件路径';
        setCaptureMessage(message);
        Alert.alert('录像完成', message);
        return;
      }

      const failureMessage = `录像停止失败，错误码：${result?.errorCode ?? 'unknown'}`;
      setCaptureMessage(failureMessage);
      Alert.alert('录像失败', failureMessage);
    } catch (error) {
      setIsRecording(false);
      const message =
        error instanceof Error ? error.message : '结束录像失败，请稍后重试。';
      setCaptureMessage(message);
      Alert.alert('录像失败', message);
    }
  }, [saveToMediaLibrary]);

  const initialScene = useMemo(
    () => ({
      scene: ModelPlacementScene as unknown as () => React.JSX.Element,
      passProps: {
        selectedModel: initialModel,
        onInitialPlanePlaced: handleInitialPlanePlaced,
        onInstanceSelected: handleInstanceSelected,
        onInstanceMultiToggle: handleInstanceMultiToggle,
        onInstanceDragged: handleInstanceDragged,
        aimWorldRef,
        cameraForwardRef,
      },
    }),
    [
      handleInitialPlanePlaced,
      handleInstanceDragged,
      handleInstanceMultiToggle,
      handleInstanceSelected,
      initialModel,
    ]
  );

  return (
    <View style={styles.container}>
      <ViroARSceneNavigator
        ref={arNavigatorRef}
        key={`${initialModel.id}-${placementSession}`}
        autofocus
        preferMonocularDepth={true}
        initialScene={initialScene}
        viroAppProps={{
          instances,
          selectedInstanceId,
          selectedInstanceIds,
          multiSelectMode,
        }}
        style={styles.arView}
      />

      <SafeAreaView pointerEvents="box-none" style={styles.overlay}>
        <View
          style={[
            styles.topPanel,
            { marginTop: topSafeOffset },
            topPanelCollapsed ? styles.topPanelCollapsed : null,
          ]}
        >
          <Pressable
            onPress={() => setTopPanelCollapsed((value) => !value)}
            style={styles.topPanelHandle}
          >
            <Text style={styles.topPanelHandleText}>
              {topPanelCollapsed ? '展开顶部面板 ▼' : '收起顶部面板 ▲'}
            </Text>
          </Pressable>

          {!topPanelCollapsed ? (
            <View style={styles.topPanelContent}>
              <View style={styles.topPanelRow}>
                <Pressable onPress={onBack} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>返回模型库</Text>
                </Pressable>

                {/* 同步状态指示器：仅在传入 syncConfig 时显示 */}
                {syncConfig ? (
                  <View style={[
                    styles.syncBadge,
                    syncStatus === 'connected' && styles.syncBadgeConnected,
                    syncStatus === 'connecting' && styles.syncBadgeConnecting,
                    syncStatus === 'error' && styles.syncBadgeError,
                  ]}>
                    <View style={[
                      styles.syncDot,
                      syncStatus === 'connected' && styles.syncDotConnected,
                      syncStatus === 'connecting' && styles.syncDotConnecting,
                      syncStatus === 'error' && styles.syncDotError,
                    ]} />
                    <Text style={styles.syncBadgeText}>
                      {syncStatus === 'connected' ? 'PC 可连接'
                        : syncStatus === 'connecting' ? '等待 PC/中继…'
                        : syncStatus === 'error' ? '离线可用'
                        : '离线可用'}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.syncBadge}>
                    <View style={styles.syncDot} />
                    <Text style={styles.syncBadgeText}>未配置 PC 连接</Text>
                  </View>
                )}
              </View>

              <View style={styles.topPanelRow}>
                <Pressable onPress={handlePlaceAtAim} style={styles.placeAimButton}>
                  <Text style={styles.placeAimButtonText}>放置到准星</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>

        {/* 实例快捷切换栏 */}
        {instances.length > 1 ? (
          <View style={styles.instanceBarWrapper}>
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={instances}
              keyExtractor={(item) => item.instanceId}
              contentContainerStyle={styles.instanceBarContent}
              renderItem={({ item, index }) => {
                const isActive = multiSelectMode
                  ? selectedInstanceIds.includes(item.instanceId)
                  : item.instanceId === selectedInstanceId;
                return (
                  <Pressable
                    onPress={() => {
                      if (multiSelectMode) {
                        handleInstanceMultiToggle(item.instanceId);
                        return;
                      }
                      setSelectedInstanceId(item.instanceId);
                      setSelectedInstanceIds([item.instanceId]);
                    }}
                    style={[
                      styles.instanceChip,
                      isActive ? styles.instanceChipActive : null,
                    ]}
                  >
                    <Text style={[
                      styles.instanceChipIndex,
                      isActive ? styles.instanceChipIndexActive : null,
                    ]}>
                      {index + 1}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.instanceChipLabel,
                        isActive ? styles.instanceChipLabelActive : null,
                      ]}
                    >
                      {item.asset.name}
                    </Text>
                    {isActive ? <View style={styles.instanceChipIndicator} /> : null}
                  </Pressable>
                );
              }}
            />
          </View>
        ) : null}

        {/* 摇杆控制区（左：移动，右：旋转） */}
        <View style={styles.joystickRow} pointerEvents="box-none">
          <View style={styles.joystickGroup}>
            <Text style={styles.joystickLabel}>移动(相对视角)</Text>
            <View style={styles.joystickBase} {...moveStickResponder.panHandlers}>
              <View
                style={[
                  styles.joystickKnob,
                  {
                    transform: [
                      { translateX: moveStick.x },
                      { translateY: moveStick.y },
                    ],
                  },
                ]}
              />
            </View>
          </View>

          <View style={styles.joystickGroup}>
            <Text style={styles.joystickLabel}>旋转</Text>
            <View style={styles.joystickBase} {...rotateStickResponder.panHandlers}>
              <View
                style={[
                  styles.joystickKnob,
                  {
                    transform: [
                      { translateX: rotateStick.x },
                      { translateY: rotateStick.y },
                    ],
                  },
                ]}
              />
            </View>
          </View>
        </View>

        <View
          style={[
            styles.joystickTuneShell,
            sensitivityCollapsedSide === 'left' ? styles.joystickTuneShellLeftCollapsed : null,
            sensitivityCollapsedSide === 'right' ? styles.joystickTuneShellRightCollapsed : null,
          ]}
          pointerEvents="box-none"
        >
          {sensitivityCollapsedSide === null ? (
            <View style={styles.joystickTunePanel}>
              <View style={styles.joystickTuneHeader}>
                <Pressable
                  onPress={() => setSensitivityCollapsedSide('left')}
                  style={styles.joystickTuneFoldButton}
                >
                  <Text style={styles.joystickTuneFoldButtonText}>向左收起</Text>
                </Pressable>
                <Text style={styles.joystickTuneTitle}>灵敏度控制</Text>
                <Pressable
                  onPress={() => setSensitivityCollapsedSide('right')}
                  style={styles.joystickTuneFoldButton}
                >
                  <Text style={styles.joystickTuneFoldButtonText}>向右收起</Text>
                </Pressable>
              </View>

              <View style={styles.joystickTuneRow}>
                <Text style={styles.joystickTuneLabel}>移动灵敏度 {joystickMoveSpeed.toFixed(3)}</Text>
                <View style={styles.joystickTuneButtons}>
                  <Pressable onPress={() => tuneMoveSpeed(-0.005)} style={styles.joystickTuneButton}>
                    <Text style={styles.joystickTuneButtonText}>-</Text>
                  </Pressable>
                  <Pressable onPress={() => tuneMoveSpeed(0.005)} style={styles.joystickTuneButton}>
                    <Text style={styles.joystickTuneButtonText}>+</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.joystickTuneRow}>
                <Text style={styles.joystickTuneLabel}>旋转灵敏度 {joystickRotateSpeed.toFixed(1)}</Text>
                <View style={styles.joystickTuneButtons}>
                  <Pressable onPress={() => tuneRotateSpeed(-0.5)} style={styles.joystickTuneButton}>
                    <Text style={styles.joystickTuneButtonText}>-</Text>
                  </Pressable>
                  <Pressable onPress={() => tuneRotateSpeed(0.5)} style={styles.joystickTuneButton}>
                    <Text style={styles.joystickTuneButtonText}>+</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={() => setSensitivityCollapsedSide(null)}
              style={styles.joystickTuneCollapsedTab}
            >
              <Text style={styles.joystickTuneCollapsedText}>
                {sensitivityCollapsedSide === 'left' ? '灵敏度 ▶' : '◀ 灵敏度'}
              </Text>
            </Pressable>
          )}
        </View>

        <View style={styles.bottomPanel}>
          <Pressable
            onPress={() => setPanelCollapsed((v) => !v)}
            style={styles.panelHeader}
          >
            <Text style={styles.modelName}>
              {selectedInstance ? selectedInstance.asset.name : pendingAsset.name}
            </Text>
            <Text style={styles.collapseIcon}>{panelCollapsed ? '▲' : '▼'}</Text>
          </Pressable>

          {!panelCollapsed ? (
            <ScrollView
              style={styles.bottomPanelScroll}
              contentContainerStyle={styles.bottomPanelScrollContent}
              nestedScrollEnabled
              showsVerticalScrollIndicator
            >
              <Text style={styles.helperText}>
                {sceneReady
                  ? '移动摇杆时以当前摄像头朝向为「前后左右」。点击模型可选中并拖动；「放置到准星」可移动选中模型到准星处。'
                  : '对准地面出现准星后，点下方「放置到准星」放下第一个模型。'}
              </Text>
              <Text style={styles.metricText}>场景模型数：{instances.length}</Text>
              <Text style={styles.metricText}>
                当前选中：{multiSelectMode ? selectedInstanceIds.length : selectedInstance ? 1 : 0}
              </Text>
              {selectedInstance ? (
                <>
                  <Text style={styles.metricText}>
                    位置 X/Z：{selectedInstance.x} / {selectedInstance.z} m
                  </Text>
                  <Text style={styles.metricText}>
                    旋转：{selectedInstance.rotationY}° · 缩放：
                    {selectedInstance.scaleValue.toFixed(2)} · 中心高度 Y：
                    {selectedInstance.y.toFixed(2)} m
                  </Text>
                </>
              ) : (
                <Text style={styles.metricText}>当前还没有选中模型实例。</Text>
              )}
              {captureMessage ? (
                <Text style={styles.captureText}>{captureMessage}</Text>
              ) : null}
              {recentSceneMeta ? (
                <Text style={styles.metricText}>
                  最近保存：{new Date(recentSceneMeta.updatedAt).toLocaleString()}
                </Text>
              ) : (
                <Text style={styles.metricText}>最近保存：暂无</Text>
              )}

              <View style={styles.actionsColumn}>
            <View style={styles.actions}>
              <Pressable onPress={handleToggleMultiSelectMode} style={styles.secondaryAction}>
                <Text style={styles.secondaryActionText}>
                  {multiSelectMode ? '退出多选模式' : '进入多选模式'}
                </Text>
              </Pressable>
              <Pressable onPress={handleClearMultiSelection} style={styles.secondaryAction}>
                <Text style={styles.secondaryActionText}>清空多选</Text>
              </Pressable>
              <Pressable onPress={handleSelectNearby} style={styles.secondaryAction}>
                <Text style={styles.secondaryActionText}>框选附近</Text>
              </Pressable>
            </View>

            <View style={styles.actions}>
              <Pressable
                onPress={() => setShowModelPicker((value) => !value)}
                style={styles.secondaryAction}
              >
                <Text style={styles.secondaryActionText}>
                  {showModelPicker ? '收起模型面板' : '添加其它模型'}
                </Text>
              </Pressable>
              <Pressable onPress={handleAddCurrentModel} style={styles.secondaryAction}>
                <Text style={styles.secondaryActionText}>再放一个当前模型</Text>
              </Pressable>
            </View>

            {showModelPicker ? (
              <View style={styles.modelPicker}>
                <Text style={styles.modelPickerTitle}>选择要追加到当前场景的模型</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.modelPickerRow}>
                    {availableModels.map((item) => {
                      const preparing = preparingModelId === item.id;
                      const active = pendingAsset.id === item.id;

                      return (
                        <Pressable
                          key={item.id}
                          disabled={preparing}
                          onPress={() => void handleChooseModel(item)}
                          style={[
                            styles.modelChip,
                            active ? styles.modelChipActive : null,
                          ]}
                        >
                          {preparing ? (
                            <ActivityIndicator color="#ffffff" />
                          ) : (
                            <Text style={styles.modelChipText}>{item.name}</Text>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                </ScrollView>
              </View>
            ) : null}

            <View style={styles.actions}>
              <Pressable onPress={handleSaveScene} style={styles.secondaryAction}>
                <Text style={styles.secondaryActionText}>保存最近场景</Text>
              </Pressable>
              <Pressable
                disabled={restoringScene}
                onPress={() => void handleRestoreRecentScene()}
                style={[styles.secondaryAction, restoringScene ? styles.buttonDisabled : null]}
              >
                {restoringScene ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.secondaryActionText}>恢复最近场景</Text>
                )}
              </Pressable>
            </View>

            <View style={styles.actions}>
              <Pressable onPress={() => adjustRotation(-15)} style={styles.secondaryAction}>
                <Text style={styles.secondaryActionText}>左转 15°</Text>
              </Pressable>
              <Pressable onPress={() => adjustRotation(15)} style={styles.secondaryAction}>
                <Text style={styles.secondaryActionText}>右转 15°</Text>
              </Pressable>
            </View>

            <View style={styles.actions}>
              <Pressable onPress={() => adjustScale(-0.1)} style={styles.secondaryAction}>
                <Text style={styles.secondaryActionText}>缩小</Text>
              </Pressable>
              <Pressable onPress={() => adjustScale(0.1)} style={styles.secondaryAction}>
                <Text style={styles.secondaryActionText}>放大</Text>
              </Pressable>
            </View>

            <View style={styles.actions}>
              <Pressable onPress={() => adjustHeight(-0.05)} style={styles.secondaryAction}>
                <Text style={styles.secondaryActionText}>降低 5cm</Text>
              </Pressable>
              <Pressable onPress={() => adjustHeight(0.05)} style={styles.secondaryAction}>
                <Text style={styles.secondaryActionText}>升高 5cm</Text>
              </Pressable>
            </View>

            <View style={styles.actions}>
              <Pressable onPress={handleTakePhoto} style={styles.secondaryAction}>
                <Text style={styles.secondaryActionText}>拍照</Text>
              </Pressable>
              {isRecording ? (
                <Pressable onPress={handleStopRecording} style={styles.recordingAction}>
                  <Text style={styles.secondaryActionText}>停止录像</Text>
                </Pressable>
              ) : (
                <Pressable onPress={handleStartRecording} style={styles.secondaryAction}>
                  <Text style={styles.secondaryActionText}>开始录像</Text>
                </Pressable>
              )}
            </View>

            <View style={styles.actions}>
              <Pressable onPress={handleDeleteSelected} style={styles.secondaryAction}>
                <Text style={styles.secondaryActionText}>删除当前模型</Text>
              </Pressable>
              <Pressable onPress={resetPlacement} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>重置整个场景</Text>
              </Pressable>
            </View>
          </View>
            </ScrollView>
          ) : null}
        </View>
      </SafeAreaView>

      <Modal
        visible={previewVisible}
        transparent
        animationType="fade"
        onRequestClose={handleClosePreview}
      >
        <View style={styles.previewMask}>
          <SafeAreaView style={styles.previewCard}>
            <Text style={styles.previewTitle}>
              {previewType === 'video' ? '录像预览' : '截图预览'}
            </Text>
            <Text style={styles.previewHint}>
              当前仅提供图片预览；视频先保存到相册后可在系统相册查看播放。
            </Text>

            {previewUri ? (
              <Image source={{ uri: previewUri }} style={styles.previewImage} resizeMode="cover" />
            ) : null}

            <View style={styles.previewActions}>
              <Pressable onPress={handleDiscardPreview} style={styles.secondaryAction}>
                <Text style={styles.secondaryActionText}>放弃</Text>
              </Pressable>
              <Pressable onPress={() => void handleSavePreview()} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>保存到相册</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  arView: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  topPanel: {
    marginHorizontal: 16,
    borderRadius: 18,
    backgroundColor: 'rgba(9, 9, 11, 0.84)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    overflow: 'hidden',
  },
  topPanelCollapsed: {
    alignSelf: 'center',
  },
  topPanelHandle: {
    minHeight: 44,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(24, 24, 27, 0.72)',
  },
  topPanelHandleText: {
    color: '#d4d4d8',
    fontSize: 12,
    fontWeight: '700',
  },
  topPanelContent: {
    padding: 12,
    gap: 10,
  },
  topPanelRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  },
  bottomPanel: {
    margin: 16,
    padding: 16,
    maxHeight: '42%',
    borderRadius: 20,
    backgroundColor: 'rgba(9, 9, 11, 0.84)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  bottomPanelScroll: {
    marginTop: 8,
  },
  bottomPanelScrollContent: {
    paddingBottom: 18,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  collapseIcon: {
    color: '#a1a1aa',
    fontSize: 14,
    paddingLeft: 8,
  },
  modelName: {
    color: '#fafafa',
    fontSize: 20,
    fontWeight: '700',
  },
  helperText: {
    marginTop: 8,
    color: '#d4d4d8',
    fontSize: 14,
    lineHeight: 20,
  },
  metricText: {
    marginTop: 8,
    color: '#a1a1aa',
    fontSize: 13,
  },
  captureText: {
    marginTop: 10,
    color: '#c4b5fd',
    fontSize: 13,
    lineHeight: 18,
  },
  modelPicker: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
  },
  modelPickerTitle: {
    color: '#e4e4e7',
    fontSize: 13,
    marginBottom: 10,
  },
  modelPickerRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modelChip: {
    minHeight: 40,
    minWidth: 110,
    paddingHorizontal: 14,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#27272a',
    borderWidth: 1,
    borderColor: '#3f3f46',
  },
  modelChipActive: {
    backgroundColor: '#7c3aed',
    borderColor: '#8b5cf6',
  },
  modelChipText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  actionsColumn: {
    marginTop: 14,
    gap: 10,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  primaryButton: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#7c3aed',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  secondaryAction: {
    flex: 1,
    minHeight: 42,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#27272a',
    borderWidth: 1,
    borderColor: '#3f3f46',
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  secondaryActionText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  recordingAction: {
    flex: 1,
    minHeight: 42,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#b91c1c',
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  placeAimButton: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#16a34a',
    borderWidth: 1,
    borderColor: '#22c55e',
  },
  placeAimButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryButton: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(9, 9, 11, 0.84)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  secondaryButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },

  // ── 实例计数 Badge ──
  countBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(124, 58, 237, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.45)',
  },
  countBadgeText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  countBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#a78bfa',
  },

  // ── 实例快捷切换栏 ──
  instanceBarWrapper: {
    marginTop: 8,
    marginHorizontal: 0,
  },
  instanceBarContent: {
    paddingHorizontal: 14,
    gap: 8,
  },
  instanceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(24, 24, 27, 0.88)',
    borderWidth: 1,
    borderColor: '#3f3f46',
    maxWidth: 140,
  },
  instanceChipActive: {
    backgroundColor: 'rgba(124, 58, 237, 0.88)',
    borderColor: '#a78bfa',
  },
  instanceChipIndex: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#3f3f46',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    color: '#a1a1aa',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 20,
  },
  instanceChipIndexActive: {
    backgroundColor: '#7c3aed',
    color: '#ffffff',
  },
  instanceChipLabel: {
    flex: 1,
    color: '#d4d4d8',
    fontSize: 12,
    fontWeight: '600',
  },
  instanceChipLabelActive: {
    color: '#ffffff',
  },
  instanceChipIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#a78bfa',
  },
  previewMask: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  previewCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 16,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#3f3f46',
    padding: 14,
    gap: 10,
  },
  previewTitle: {
    color: '#fafafa',
    fontSize: 18,
    fontWeight: '700',
  },
  previewHint: {
    color: '#a1a1aa',
    fontSize: 12,
    lineHeight: 18,
  },
  previewImage: {
    width: '100%',
    height: 220,
    borderRadius: 12,
    backgroundColor: '#27272a',
  },
  previewActions: {
    marginTop: 4,
    flexDirection: 'row',
    gap: 10,
  },
  joystickTuneShell: {
    marginHorizontal: 16,
    marginBottom: 10,
  },
  joystickTuneShellLeftCollapsed: {
    alignItems: 'flex-start',
  },
  joystickTuneShellRightCollapsed: {
    alignItems: 'flex-end',
  },
  joystickTunePanel: {
    padding: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(9, 9, 11, 0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    gap: 8,
  },
  joystickTuneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  joystickTuneTitle: {
    flex: 1,
    textAlign: 'center',
    color: '#fafafa',
    fontSize: 12,
    fontWeight: '800',
  },
  joystickTuneFoldButton: {
    minHeight: 26,
    paddingHorizontal: 10,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#27272a',
    borderWidth: 1,
    borderColor: '#3f3f46',
  },
  joystickTuneFoldButtonText: {
    color: '#d4d4d8',
    fontSize: 11,
    fontWeight: '700',
  },
  joystickTuneCollapsedTab: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(9, 9, 11, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  joystickTuneCollapsedText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  joystickTuneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  joystickTuneLabel: {
    color: '#d4d4d8',
    fontSize: 12,
    fontWeight: '600',
  },
  joystickTuneButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  joystickTuneButton: {
    width: 30,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#27272a',
    borderWidth: 1,
    borderColor: '#3f3f46',
  },
  joystickTuneButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 18,
  },
  joystickRow: {
    paddingHorizontal: 18,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  joystickGroup: {
    alignItems: 'center',
    gap: 8,
  },
  joystickLabel: {
    color: '#e4e4e7',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  joystickBase: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(24, 24, 27, 0.8)',
    borderWidth: 1,
    borderColor: '#3f3f46',
    justifyContent: 'center',
    alignItems: 'center',
  },
  joystickKnob: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#7c3aed',
    borderWidth: 1,
    borderColor: '#a78bfa',
  },

  // ── 同步状态指示器 ──
  syncBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(24, 24, 27, 0.85)',
    borderWidth: 1,
    borderColor: '#3f3f46',
    alignSelf: 'flex-start' as const,
  },
  syncBadgeConnected: {
    backgroundColor: 'rgba(22, 101, 52, 0.85)',
    borderColor: '#16a34a',
  },
  syncBadgeConnecting: {
    backgroundColor: 'rgba(120, 83, 7, 0.85)',
    borderColor: '#d97706',
  },
  syncBadgeError: {
    backgroundColor: 'rgba(127, 29, 29, 0.85)',
    borderColor: '#dc2626',
  },
  syncBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600' as const,
  },
  syncDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#71717a',
  },
  syncDotConnected: {
    backgroundColor: '#4ade80',
  },
  syncDotConnecting: {
    backgroundColor: '#fbbf24',
  },
  syncDotError: {
    backgroundColor: '#f87171',
  },
});
 
