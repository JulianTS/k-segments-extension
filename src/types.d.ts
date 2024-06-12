export interface NodeScore {
    Host: string;
    Score: number;
}

interface Pod {
    metadata: {
        name: string;
        [key: string]: any;
    };
    [key: string]: any;
}

interface FilterRequest {
    Pod: PodSpec;
    Nodes: NodesList;
    NodeNames: string[] | null;
}

interface PodSpec {
    metadata: PodMetadata;
    spec: PodSpecDetails;
    status: PodStatus;
}

interface PodMetadata {
    name: string;
    namespace: string;
    uid: string;
    resourceVersion: string;
    creationTimestamp: string;
    labels: Labels;
    annotations: { [key: string]: string };
    managedFields: ManagedField[];
}

interface Labels {
    [key: string]: string;
    taskName?: string;
    'nextflow.io/taskName'?: string;
}

interface PodSpecDetails {
    volumes: Volume[];
    containers: Container[];
    restartPolicy: string;
    terminationGracePeriodSeconds: number;
    dnsPolicy: string;
    serviceAccountName: string;
    serviceAccount: string;
    securityContext: any;
    schedulerName: string;
    tolerations: Toleration[];
    priority: number;
    enableServiceLinks: boolean;
    preemptionPolicy: string;
}

interface Container {
    name: string;
    image: string;
    resources: {
        limits: ResourceLimits;
        requests: ResourceLimits;
    };
    resizePolicy: ResizePolicy[];
    volumeMounts: VolumeMount[];
    terminationMessagePath: string;
    terminationMessagePolicy: string;
    imagePullPolicy: string;
}

interface VolumeMount {
    name: string;
    readOnly: boolean;
    mountPath: string;
}

interface ResizePolicy {
    resourceName: string;
    restartPolicy: string;
}

interface ResourceLimits {
    cpu: string;
    memory: string;
}

interface PodStatus {
    phase: string;
    qosClass: string;
}

interface ManagedField {
    manager: string;
    operation: string;
    apiVersion: string;
    time: string;
    fieldsType: string;
    fieldsV1: any;
}

interface Volume {
    name: string;
    projected: Projected;
}

interface Projected {
    sources: any[];
    defaultMode: number;
}

interface Toleration {
    key: string;
    operator: string;
    effect: string;
    tolerationSeconds: number;
}

interface NodesList {
    metadata: any;
    items: NodeItem[];
}

interface NodeItem {
    metadata: NodeMetadata;
    spec: NodeSpec;
    status: NodeStatus;
}

interface NodeMetadata {
    name: string;
    uid: string;
    resourceVersion: string;
    creationTimestamp: string;
    labels: { [key: string]: string };
    annotations: { [key: string]: string };
    finalizers: string[];
    managedFields: ManagedField[];
}

interface NodeSpec {
    podCIDR: string;
    podCIDRs: string[];
    providerID: string;
}

interface NodeStatus {
    capacity: ResourceLimits;
    allocatable: ResourceLimits;
    conditions: any[];
    addresses: any[];
    daemonEndpoints: any;
    nodeInfo: any;
    images: any[];
}

interface NodeSuitabilityResult {
    canFit: boolean;
    score?: number;
}

interface patchTime {
    time: Date,
    val: number
}