// The Kubernetes terms and the abbreviations readers can hover on any page (terms.js marks them).
// A term belongs here once a page uses it; an abbreviation must be here, or glossary.test.js fails.

const DOCS = "https://kubernetes.io/docs/";

/** pattern as a whole name, never part of a longer one such as node-exporter, NodePort or Node.js. */
const whole = (pattern) => new RegExp(String.raw`(?<![\w-])(?:${pattern.source})(?![\w-]|\.\w)`, pattern.flags);

/** A Kubernetes term: pattern finds its mentions, text explains it in two to four sentences, path is under kubernetes.io/docs. */
const term = (id, name, pattern, path, text) => ({ id, name, pattern: whole(pattern), url: DOCS + path, text });

/** An abbreviation, shown with its full form; its plural (IPs) and compounds (OOM-killed) count as mentions. */
const abbr = (short, full) => ({ id: short, name: short, full, pattern: new RegExp(String.raw`(?<!\w)${short}s?(?!\w)`) });

/** Every term, explained for someone new to Kubernetes, then every abbreviation the pages use. */
export const TERMS = [
  // Cluster
  term("node", "Node", /nodes?/i, "concepts/architecture/nodes/",
    "A machine, virtual or physical, that runs pods. Each node runs the kubelet, which starts its containers, and kube-proxy, which makes Service addresses work. The scheduler decides which node each pod runs on."),
  term("control-plane", "Control plane", /control plane/i, "concepts/overview/components/#control-plane-components",
    "The components that manage the cluster: the API server, etcd, the scheduler and the controller manager. They decide what should run where. The kubelets on the nodes do the running."),
  term("api-server", "API server", /API server|kube-apiserver/, "concepts/overview/kubernetes-api/",
    "The front door of the control plane: kubectl, controllers and kubelets all work with the cluster through its REST API. It checks who is calling and what RBAC allows, then stores the objects in etcd."),
  term("etcd", "etcd", /etcd/, "tasks/administer-cluster/configure-upgrade-etcd/",
    "The key-value database that stores every object of the cluster. Only the API server talks to it, and losing it means losing the cluster's state."),
  term("scheduler", "Scheduler", /(?:kube-)?scheduler/i, "concepts/scheduling-eviction/kube-scheduler/",
    "The control-plane component that picks a node for every new pod. It drops the nodes that can't fit the pod's resource requests and constraints, then scores the rest and picks the best."),
  term("kubelet", "kubelet", /kubelet/i, "reference/command-line-tools-reference/kubelet/",
    "The agent on every node that runs the pods assigned to it. It has the container runtime start their containers, runs their probes and reports their status to the API server. It also serves the node's CPU and memory metrics."),
  term("kube-proxy", "kube-proxy", /kube-proxy/, "reference/networking/virtual-ips/",
    "Runs on every node and makes Service addresses work. It watches Services and their EndpointSlices and writes the node's packet rules (iptables or IPVS), so a connection to a Service IP reaches one of its pods."),
  term("coredns", "CoreDNS", /CoreDNS/, "concepts/services-networking/dns-pod-service/",
    "The cluster's DNS server. It answers names such as my-service.my-namespace.svc.cluster.local with the Service's IP address, so pods find each other by name."),
  term("namespace", "Namespace", /namespaces?/i, "concepts/overview/working-with-objects/namespaces/",
    "A named group of objects inside one cluster. Names only need to be unique within a namespace, and access rules, Secrets and quotas are scoped to it. Namespaces don't block network traffic between each other on their own."),
  term("kubectl", "kubectl", /kubectl/, "reference/kubectl/",
    "The command-line client for the Kubernetes API. It reads, creates and changes objects, for example kubectl get pods or kubectl apply -f manifest.yaml."),
  term("kustomize", "Kustomize", /Kustomize/i, "tasks/manage-kubernetes-objects/kustomization/",
    "A tool built into kubectl (kubectl apply -k) that assembles manifests from a kustomization.yaml. It lists the resources, generates ConfigMaps from plain files and patches settings, without templates."),
  term("crd", "Custom resource", /CRDs?|custom resources?|CustomResourceDefinitions?/i, "concepts/extend-kubernetes/api-extension/custom-resources/",
    "A new kind of object added to the Kubernetes API by a CustomResourceDefinition (CRD), such as HTTPRoute. A controller that watches those objects gives them behaviour."),

  // Workloads
  term("pod", "Pod", /pods?/i, "concepts/workloads/pods/",
    "The smallest thing Kubernetes runs: one or more containers that share an IP address and can share volumes. Pods are ephemeral. A controller such as a Deployment creates them and replaces them when they fail."),
  term("container", "Container", /(?<!init )containers?/i, "concepts/containers/",
    "A process packaged with everything it needs as an image, and run isolated from the other processes on the node. In Kubernetes containers always run inside pods, started by the kubelet through a container runtime such as containerd."),
  term("init-container", "Init container", /init containers?/i, "concepts/workloads/pods/init-containers/",
    "A container that runs to completion before the pod's app containers start. Init containers run one after another, and each must succeed. They suit setup work, such as migrating a database schema."),
  term("sidecar", "Sidecar", /sidecars?/i, "concepts/workloads/pods/sidecar-containers/",
    "A helper container that runs next to the main container in the same pod, sharing its network and volumes. Typical sidecars are proxies, log shippers and metrics exporters."),
  term("controller", "Controller", /controllers?/i, "concepts/architecture/controller/",
    "A control loop that watches the cluster and changes it until its actual state matches the desired state written in an object. The Deployment controller, for example, creates or deletes pods until the right number runs. Most of Kubernetes is controllers reacting to changes in the API."),
  term("workload", "Workload", /workloads?/i, "concepts/workloads/",
    "An app running on Kubernetes, declared as a workload resource: a Deployment, StatefulSet, DaemonSet or Job. Its controller creates the pods and replaces any that fail. Here, stock-app is a Deployment and TimescaleDB a StatefulSet."),
  term("deployment", "Deployment", /Deployments?/, "concepts/workloads/controllers/deployment/",
    "Runs a number of identical, interchangeable pods and keeps that number running. Changing its pod template starts a rolling update: a new ReplicaSet takes over from the old one step by step. It suits stateless apps."),
  term("replicaset", "ReplicaSet", /ReplicaSets?/, "concepts/workloads/controllers/replicaset/",
    "Keeps a fixed number of identical pods running and replaces any that disappear. You rarely create one yourself: a Deployment creates one per version of its pod template and scales them during a rollout."),
  term("statefulset", "StatefulSet", /StatefulSets?/, "concepts/workloads/controllers/statefulset/",
    "Runs pods that each keep a stable identity: a fixed name (db-0, db-1), a stable DNS name and their own PersistentVolumeClaim. Pods start, update and stop in order. It suits databases and other stateful apps."),
  term("daemonset", "DaemonSet", /DaemonSets?/, "concepts/workloads/controllers/daemonset/",
    "Runs one copy of a pod on every node, or on every node that matches a selector. A node that joins the cluster gets its copy automatically. It suits node agents such as log collectors and metrics exporters."),
  term("job", "Job", /Jobs?/, "concepts/workloads/controllers/job/",
    "Runs pods until a set number of them finish successfully, then stops. Failed pods are retried up to a limit. It suits one-off tasks such as migrations or batch work."),
  term("cronjob", "CronJob", /CronJobs?/, "concepts/workloads/controllers/cron-jobs/",
    "Creates a Job on a schedule written in cron syntax, such as every night at 02:00. Each run is a new Job with its own pods."),
  term("probe", "Probe", /probes?/i, "concepts/configuration/liveness-readiness-startup-probes/",
    "A health check the kubelet runs against a container: an HTTP request, a TCP connection or a command. A failing liveness probe restarts the container. A failing readiness probe only stops traffic to the pod. A startup probe holds the other two off until a slow app has started."),
  term("label", "Label", /labels?/i, "concepts/overview/working-with-objects/labels/",
    "A key-value pair on an object, such as app: stock-app, used to group and select objects. Services, Deployments and kubectl find their pods with label selectors."),
  term("selector", "Selector", /selectors?/i, "concepts/overview/working-with-objects/labels/#label-selectors",
    "A query on labels, such as app=stock-app, that picks the objects a Service, Deployment or NetworkPolicy works on. Every object whose labels match is included, including pods created later."),
  term("annotation", "Annotation", /annotations?/i, "concepts/overview/working-with-objects/annotations/",
    "A key-value pair on an object for tools and people to read, never used to select objects. Annotations often hold settings that a controller or Prometheus reads, or build information."),
  term("informer", "Informer", /informers?/i, "reference/using-api/api-concepts/#efficient-detection-of-changes",
    "A client-side cache of API objects, kept current by a watch. It lists the objects once, then receives every change as an event, so a program can read the cluster often without asking the API server each time."),

  // Networking
  term("service", "Service", /Services?/, "concepts/services-networking/service/",
    "A stable virtual IP address and DNS name in front of a changing set of pods, picked by a label selector. Connections to it are spread over its ready pods. Its type decides who can reach it: ClusterIP (inside the cluster), NodePort or LoadBalancer."),
  term("clusterip", "ClusterIP", /ClusterIP/, "concepts/services-networking/service/#type-clusterip",
    "The default Service type: a virtual IP address reachable only from inside the cluster. kube-proxy on every node turns a connection to it into a connection to one of the Service's pods."),
  term("nodeport", "NodePort", /NodePorts?/, "concepts/services-networking/service/#type-nodeport",
    "A Service type that opens the same port (30000-32767) on every node and forwards it to the Service's pods. It is the simplest way to reach a Service from outside the cluster."),
  term("endpointslice", "EndpointSlice", /EndpointSlices?|Endpoints/, "concepts/services-networking/endpoint-slices/",
    "The list of pod addresses and ports behind a Service, kept up to date by a controller as pods come and go. Only ready pods are marked ready in it. kube-proxy and service discovery, such as Prometheus', read these lists."),
  term("gateway-api", "Gateway API", /Gateway API/, "concepts/services-networking/gateway/",
    "The Kubernetes API for routing traffic from outside into the cluster, successor to Ingress. A GatewayClass names the implementation, a Gateway is the entry point, and routes such as HTTPRoute decide which Service gets each request. A controller such as Envoy Gateway implements it."),
  term("gatewayclass", "GatewayClass", /GatewayClass(?:es)?/, "concepts/services-networking/gateway/",
    "Names the controller that implements the Gateways of this class, such as Envoy Gateway. It is cluster-wide and usually set up once, by the platform team."),
  term("gateway", "Gateway", /(?<!Envoy )Gateways?(?! API)/, "concepts/services-networking/gateway/",
    "An entry point for traffic into the cluster: the addresses, ports and protocols to listen on. Its controller runs a proxy that accepts the traffic, and routes attach to the Gateway to say where requests go."),
  term("httproute", "HTTPRoute", /HTTPRoutes?/, "concepts/services-networking/gateway/",
    "Rules that send HTTP requests arriving at a Gateway to Services, matched by hostname, path or headers. It can also change requests on the way, for example add CORS headers. Each app usually owns its own route."),
  term("ingress", "Ingress", /Ingress(?:es)?/, "concepts/services-networking/ingress/",
    "The older API for routing HTTP traffic from outside to Services, by hostname and path. It needs an ingress controller to work, and Kubernetes now recommends the Gateway API instead."),
  term("networkpolicy", "NetworkPolicy", /NetworkPolic(?:y|ies)/, "concepts/services-networking/network-policies/",
    "A firewall rule for pods: which pods or addresses may connect to or from the pods it selects. Without any policy, every pod can reach every other. It only works if the cluster's network plugin enforces it."),

  // Configuration and storage
  term("configmap", "ConfigMap", /ConfigMaps?/, "concepts/configuration/configmap/",
    "Holds configuration that isn't secret, as key-value pairs or whole files. Pods read it as environment variables or as files in a volume. Mounted files follow changes after a short delay. Environment variables only change when the container restarts."),
  term("secret", "Secret", /Secrets?/, "concepts/configuration/secret/",
    "Holds small pieces of sensitive data, such as passwords, tokens or keys, for pods to read as files or environment variables. The values are only base64-encoded, not encrypted, so RBAC must limit who can read Secrets."),
  term("volume", "Volume", /volumes?/i, "concepts/storage/volumes/",
    "A directory that a pod's containers can mount. Some kinds live only as long as the pod (emptyDir). Others bring in a ConfigMap, a Secret or durable storage through a PersistentVolumeClaim."),
  term("emptydir", "emptyDir", /emptyDir/, "concepts/storage/volumes/#emptydir",
    "A volume that starts empty when the pod starts on a node and is deleted with the pod. The pod's containers can share files through it. It survives a container restart, but not a new pod."),
  term("pvc", "PersistentVolumeClaim", /PersistentVolumeClaims?|PVCs?/, "concepts/storage/persistent-volumes/",
    "A pod's request for durable storage: a size and an access mode. Kubernetes binds it to a matching PersistentVolume, often created on demand through a StorageClass. The data outlives the pod."),
  term("pv", "PersistentVolume", /PersistentVolumes?|PVs?/, "concepts/storage/persistent-volumes/",
    "A piece of storage in the cluster, such as a disk or a directory on a node, that exists apart from any pod. A PersistentVolumeClaim binds to it, and its reclaim policy decides what happens to the data when the claim is deleted."),
  term("storageclass", "StorageClass", /StorageClass(?:es)?/, "concepts/storage/storage-classes/",
    "Describes a kind of storage and the provisioner that creates it. When a PersistentVolumeClaim asks for a StorageClass, its provisioner creates a matching PersistentVolume on demand."),

  // Access control
  term("serviceaccount", "ServiceAccount", /ServiceAccounts?|[Ss]ervice accounts?/, "concepts/security/service-accounts/",
    "An identity for the processes in a pod, as opposed to a user account for people. Each pod runs as one ServiceAccount, and RBAC decides what it may do in the Kubernetes API. Its token can also prove the pod's identity to other systems."),
  { ...term("rbac", "RBAC", /RBAC/, "reference/access-authn-authz/rbac/",
    "How Kubernetes decides who may do what in its API. A Role or ClusterRole lists allowed actions, such as get and list on pods, and a binding grants them to users, groups or ServiceAccounts. Anything not allowed is denied."),
    full: "Role-based access control" },
  term("role", "Role", /(?:Cluster)?Roles?/, "reference/access-authn-authz/rbac/#role-and-clusterrole",
    "A list of allowed actions on API resources, such as get and list on pods. A Role applies inside one namespace. A ClusterRole applies cluster-wide or can be reused in many namespaces. It grants nothing until a binding connects it to someone."),
  term("rolebinding", "RoleBinding", /(?:Cluster)?RoleBindings?/, "reference/access-authn-authz/rbac/#rolebinding-and-clusterrolebinding",
    "Grants the actions of a Role or ClusterRole to users, groups or ServiceAccounts. A RoleBinding grants them in its own namespace, a ClusterRoleBinding in every namespace."),
  term("tokenreview", "TokenReview", /TokenReviews?/, "reference/kubernetes-api/authentication-resources/token-review-v1/",
    "An API call that checks a ServiceAccount token: the API server answers whether it is valid and whose it is. Systems outside Kubernetes, such as Vault, use it to trust a pod's identity."),
  // Abbreviations
  abbr("ACME", "Automatic Certificate Management Environment: how Let's Encrypt issues certificates"),
  abbr("ALB", "Application Load Balancer (AWS)"),
  abbr("API", "Application programming interface"),
  abbr("AWS", "Amazon Web Services"),
  abbr("CA", "Certificate authority"),
  abbr("CI", "Continuous integration"),
  abbr("CNI", "Container Network Interface"),
  abbr("CORS", "Cross-origin resource sharing"),
  abbr("CPU", "Central processing unit"),
  abbr("CSI", "Container Storage Interface"),
  abbr("CSR", "Certificate signing request"),
  abbr("CSS", "Cascading Style Sheets"),
  abbr("DNAT", "Destination network address translation"),
  abbr("DNS", "Domain Name System"),
  abbr("EBS", "Amazon Elastic Block Store"),
  abbr("EKS", "Amazon Elastic Kubernetes Service"),
  abbr("GB", "Gigabyte"),
  abbr("GKE", "Google Kubernetes Engine"),
  abbr("HTML", "HyperText Markup Language"),
  abbr("HTTP", "HyperText Transfer Protocol"),
  abbr("HTTPS", "HTTP over TLS (encrypted HTTP)"),
  abbr("ID", "Identifier"),
  abbr("IP", "Internet Protocol"),
  abbr("IPVS", "IP Virtual Server"),
  abbr("JSON", "JavaScript Object Notation"),
  abbr("JWT", "JSON Web Token: signed claims, such as a ServiceAccount token"),
  abbr("KMS", "Key Management Service"),
  abbr("KV", "Key-value"),
  abbr("L7", "Layer 7: the application layer of the network model, such as HTTP"),
  abbr("mTLS", "Mutual TLS: the client shows a certificate too"),
  abbr("NAT", "Network address translation"),
  abbr("NFS", "Network File System"),
  abbr("NLB", "Network Load Balancer (AWS)"),
  abbr("NXDOMAIN", "Non-existent domain: the DNS answer for a name that doesn't exist"),
  abbr("OOM", "Out of memory"),
  abbr("OTLP", "OpenTelemetry Protocol"),
  abbr("PSA", "Pod Security Admission"),
  abbr("PSS", "Pod Security Standards"),
  abbr("RED", "Rate, errors, duration: the three signals of a request-driven service"),
  abbr("SDK", "Software development kit"),
  abbr("SLI", "Service level indicator"),
  abbr("SLO", "Service level objective"),
  abbr("SNAT", "Source network address translation"),
  abbr("SNI", "Server Name Indication: the hostname a TLS client sends in the handshake"),
  abbr("SQL", "Structured Query Language"),
  abbr("TLS", "Transport Layer Security"),
  abbr("UI", "User interface"),
  abbr("URL", "Uniform Resource Locator"),
  abbr("VM", "Virtual machine"),
  abbr("VPC", "Virtual Private Cloud"),
  abbr("W3C", "World Wide Web Consortium"),
  abbr("YAML", "YAML Ain't Markup Language"),
];

/**
 * The earliest mention in text of a term whose id is not in skip, as {term, index, length}, or null.
 * Mentions at the same position go to the longer name.
 */
export function findTerm(text, skip = new Set()) {
  let best = null;
  for (const entry of TERMS) {
    if (skip.has(entry.id)) continue;
    const match = entry.pattern.exec(text);
    if (match && (!best || match.index < best.index || (match.index === best.index && match[0].length > best.length))) {
      best = { term: entry, index: match.index, length: match[0].length };
    }
  }
  return best;
}
