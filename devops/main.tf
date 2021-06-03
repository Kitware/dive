variable "project_name" {
  type = string
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "zone" {
  type    = string
  default = "us-central1-b"
}

variable "node_count" {
  type    = number
  default = 1
}

variable "machine_type" {
  type    = string
  default = "a2-highgpu-1g"
}

variable "disk_size" {
  type    = number
  default = 128 # Size in GB
}

variable "ssh_key" {
  type    = string
  default = "~/.ssh/gcloud_key"
}

variable "user" {
  type    = string
  default = "viame"
}

provider "google" {
  project = var.project_name
  region  = var.region
  zone    = var.zone
}

resource "google_compute_firewall" "firewall-externalssh" {
  name    = "firewall-externalssh"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["externalssh"]
}


resource "google_compute_instance" "default" {
  name         = "terraform-dive-instance"
  machine_type = var.machine_type
  tags         = ["viame-linux", "dive", "docker", "nvidia"]
  count        = var.node_count

  boot_disk {
    initialize_params {
      # List images:
      # gcloud compute images list
      image = "ubuntu-os-cloud/ubuntu-2004-lts"
      size  = var.disk_size
      type  = "pd-ssd" # regular block device is too slow
    }
  }

  network_interface {
    network = "default"

    access_config {
      // Include this section to give the VM an ephemeral external ip address
    }
  }

  scheduling {
    # Default true, not supported for GPU nodes, causes failure
    # https://groups.google.com/g/gce-discussion/c/e9K3h3fQuJk
    # https://cloud.google.com/compute/docs/instances/live-migration
    automatic_restart   = false
    
    # Migrate if machine type is cpu, else terminate if gpu
    # https://cloud.google.com/compute/docs/gpus/create-vm-with-gpus
    # > VMs with GPUs cannot live migrate, make sure that you set the --maintenance-policy TERMINATE flag.
    on_host_maintenance = "${ length(split("highgpu", var.machine_type)) == 1 ? "MIGRATE" : "TERMINATE"}"
  }

  # Ensure firewall rule is provisioned before server, so that SSH doesn't fail.
  depends_on = [google_compute_firewall.firewall-externalssh]

  metadata = {
    ssh-keys = "${var.user}:${file(format("%s%s", var.ssh_key, ".pub"))}"
  }
}

resource "local_file" "inventory" {
  depends_on = [google_compute_instance.default]
  content = templatefile("./ansible/inventory.tmpl", {
    hostname  = google_compute_instance.default.*.instance_id
    public-ip = google_compute_instance.default.*.network_interface.0.access_config.0.nat_ip
    ssh-key   = "${pathexpand(var.ssh_key)}"
    ssh-user  = "${var.user}"
  })
  filename = "inventory"
}
