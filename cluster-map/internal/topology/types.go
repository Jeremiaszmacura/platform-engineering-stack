// Package topology turns Kubernetes objects into the cluster map: pods, Services, identities, storage and links.
package topology

import (
	"time"

	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// Snapshot is everything Build needs, read from the API at one point in time.
type Snapshot struct {
	ClusterName         string
	Version             string
	TakenAt             time.Time
	Nodes               []*corev1.Node
	Pods                []*corev1.Pod
	Services            []*corev1.Service
	ServiceAccounts     []*corev1.ServiceAccount
	Claims              []*corev1.PersistentVolumeClaim
	Volumes             []*corev1.PersistentVolume
	Gateways            []*gatewayv1.Gateway
	HTTPRoutes          []*gatewayv1.HTTPRoute
	NetworkPolicies     []*networkingv1.NetworkPolicy
	ClusterRoles        []*rbacv1.ClusterRole
	Roles               []*rbacv1.Role
	ClusterRoleBindings []*rbacv1.ClusterRoleBinding
	RoleBindings        []*rbacv1.RoleBinding
	ProxyConfig         string
	PrometheusConfig    string
	References          []Reference
}

// Reference is a Service address the API objects don't show, e.g. Grafana's datasource in a provisioning file.
type Reference struct {
	App   string
	Value string
}

// Map is the JSON document the page renders.
type Map struct {
	GeneratedAt      time.Time        `json:"generated_at"`
	Context          string           `json:"context"`
	Version          string           `json:"version"`
	SystemNamespaces []string         `json:"system_namespaces"`
	Ranges           Ranges           `json:"ranges"`
	Nodes            []Node           `json:"nodes"`
	Pods             []Pod            `json:"pods"`
	Services         []Service        `json:"services"`
	Gateways         []Gateway        `json:"gateways"`
	Routes           []Route          `json:"routes"`
	ServiceAccounts  []ServiceAccount `json:"service_accounts"`
	Config           []ConfigUse      `json:"config"`
	Volumes          []Volume         `json:"volumes"`
	Links            []Link           `json:"links"`
	NetworkPolicies  []string         `json:"network_policies"`
}

// Ranges are the node, pod and Service address ranges.
type Ranges struct {
	Nodes    string `json:"nodes"`
	Pods     string `json:"pods"`
	Services string `json:"services"`
}

// Node is a cluster node with the kube-system agents running on it.
type Node struct {
	Name    string   `json:"name"`
	IP      string   `json:"ip"`
	PodCIDR string   `json:"pod_cidr"`
	Roles   []string `json:"roles"`
	Taints  []string `json:"taints"`
	Agents  []string `json:"agents"`
}

// Pod is a pod with the identity, configuration and storage it uses.
type Pod struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	Namespace      string   `json:"namespace"`
	App            string   `json:"app"`
	IP             string   `json:"ip"`
	Node           string   `json:"node"`
	HostNetwork    bool     `json:"host_network"`
	Phase          string   `json:"phase"`
	Owner          string   `json:"owner"`
	ServiceAccount string   `json:"service_account"`
	TokenMounted   bool     `json:"token_mounted"`
	Secrets        []string `json:"secrets"`
	ConfigMaps     []string `json:"config_maps"`
	Volumes        []string `json:"volumes"`
	Probes         []string `json:"probes"`
}

// Service is a Service with its ready pods and the hostnames accepted HTTPRoutes send to it.
type Service struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Namespace   string   `json:"namespace"`
	Type        string   `json:"type"`
	ClusterIP   string   `json:"cluster_ip"`
	Ports       []string `json:"ports"`
	TargetPorts []string `json:"target_ports"`
	NodePorts   []string `json:"node_ports"`
	DNS         string   `json:"dns"`
	Scraped     bool     `json:"scraped"`
	Job         string   `json:"job"`
	Hostnames   []string `json:"hostnames"`
	CORS        bool     `json:"cors"`
	Pods        []string `json:"pods"`
}

// Gateway is a Gateway API entry point: its listeners, and the proxy pods and Service that serve it.
type Gateway struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	Namespace    string     `json:"namespace"`
	Class        string     `json:"class"`
	Programmed   bool       `json:"programmed"`
	Addresses    []string   `json:"addresses"`
	Listeners    []Listener `json:"listeners"`
	ProxyPods    []string   `json:"proxy_pods"`
	ProxyService string     `json:"proxy_service"`
}

// Listener is a port a Gateway accepts traffic on, and which namespaces may attach routes to it.
type Listener struct {
	Name           string `json:"name"`
	Protocol       string `json:"protocol"`
	Port           int32  `json:"port"`
	Hostname       string `json:"hostname"`
	AllowedRoutes  string `json:"allowed_routes"`
	AttachedRoutes int32  `json:"attached_routes"`
}

// Route is an HTTPRoute: the hostnames it claims, where it sends them and what its Gateway thinks of it.
type Route struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Namespace string    `json:"namespace"`
	Gateways  []string  `json:"gateways"`
	Hostnames []string  `json:"hostnames"`
	Backends  []Backend `json:"backends"`
	Filters   []string  `json:"filters"`
	Accepted  bool      `json:"accepted"`
	Status    string    `json:"status"`
}

// Backend is a Service port an HTTPRoute sends traffic to.
type Backend struct {
	Service string `json:"service"`
	Port    int32  `json:"port"`
}

// ServiceAccount is an identity, the pods running as it and its RBAC permissions.
type ServiceAccount struct {
	Name         string   `json:"name"`
	Namespace    string   `json:"namespace"`
	Automount    string   `json:"automount"`
	UsedBy       []string `json:"used_by"`
	TokenMounted bool     `json:"token_mounted"`
	Permissions  []string `json:"permissions"`
}

// ConfigUse is a Secret or ConfigMap that pods reference, with the keys they read.
type ConfigUse struct {
	Kind      string   `json:"kind"`
	Name      string   `json:"name"`
	Namespace string   `json:"namespace"`
	Keys      []string `json:"keys"`
	UsedBy    []string `json:"used_by"`
}

// Volume is a PersistentVolumeClaim traced to its PersistentVolume and node.
type Volume struct {
	Claim        string   `json:"claim"`
	Namespace    string   `json:"namespace"`
	StorageClass string   `json:"storage_class"`
	Capacity     string   `json:"capacity"`
	AccessModes  []string `json:"access_modes"`
	Volume       string   `json:"volume"`
	Node         string   `json:"node"`
	Path         string   `json:"path"`
	Pods         []string `json:"pods"`
}

// Link is a connection one pod opens to another.
type Link struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Label  string `json:"label"`
	Kind   string `json:"kind"`
}
