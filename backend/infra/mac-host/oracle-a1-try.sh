#!/bin/zsh
# ONE attempt to launch the Always Free ARM VM in Oracle Mumbai (VM.Standard.A1.Flex), meant to be run
# every five minutes by launchd until it lands. "Out of host capacity" is a regional queue, not an
# account problem, and each attempt costs nothing. Every fifth attempt asks for the smaller 1 OCPU / 6 GB.
# Network, image, AD and SSH key were created on 2026-09-21 and live in ~/.config/dos/oci-ids.env.
export PATH=/opt/homebrew/bin:$PATH
CFG=$HOME/.config/dos/oci-ids.env; LOG=$HOME/Library/Logs/dos/oracle.log; N=$HOME/.config/dos/oci-attempts
. "$CFG"
[ -n "$INSTANCE" ] && exit 0                       # already landed: nothing to do, ever
i=$(( $(cat "$N" 2>/dev/null || echo 0) + 1 )); echo $i > "$N"
if [ $((i % 5)) -eq 0 ]; then O=1; M=6; else O=2; M=12; fi
R=$(oci compute instance launch -c "$TENANCY" --availability-domain "$AD" --subnet-id "$SUBNET" \
  --shape VM.Standard.A1.Flex --shape-config "{\"ocpus\":$O,\"memoryInGBs\":$M}" \
  --image-id "$IMAGE" --boot-volume-size-in-gbs 100 --display-name dos-prod \
  --assign-public-ip true --ssh-authorized-keys-file "$HOME/.ssh/dos_oracle.pub" \
  --query 'data.id' --raw-output 2>&1)
if echo "$R" | grep -q '^ocid1.instance'; then
  echo "INSTANCE=$R" >> "$CFG"
  echo "$(date '+%F %T') attempt $i: LAUNCHED $O ocpu/$M GB -> $R" >> "$LOG"
  sleep 60
  IP=$(oci compute instance list-vnics --instance-id "$R" --query 'data[0]."public-ip"' --raw-output 2>/dev/null)
  echo "PUBLIC_IP=$IP" >> "$CFG"; echo "$(date '+%F %T') public ip: $IP" >> "$LOG"
  exit 0
fi
echo "$(date '+%F %T') attempt $i ($O/$M): $(echo "$R" | grep -o '"message": "[^"]*"' | head -1)" >> "$LOG"
