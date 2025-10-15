Terraform set up:

# Create an Ed25519 keypair at C:\Users\Elton\.ssh\id_ed25519
ssh-keygen -t ed25519 -C "Elton@laptop" -f "C:\Users\Elton\.ssh\id_ed25519"
C:\Users\Elton\.ssh\id_ed25519
type "C:\Users\Elton\.ssh\id_ed25519.pub" -> to see the public key


**replace this in terraform under terraform.tfvars:**
ssh_public_key  = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIE3bTMVJc9oEZygz6PuQOOXqeiK0l9XmHgQMu33GibtP Elton@laptop" //with your own

u will need the private key to ssh later the one with eid: id_edxxxx

reset if ur lab changes:
Remove-Item Env:AWS_ACCESS_KEY_ID, Env:AWS_SECRET_ACCESS_KEY, Env:AWS_SESSION_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:AWS_PROFILE, Env:AWS_DEFAULT_PROFILE -ErrorAction SilentlyContinue


then to set up:
aws configure set aws_access_key_id     ASIAU6GD3KNIW7WR3R7S        --profile dev
aws configure set aws_secret_access_key RKI9zImCyEQFa7MrRbddNUavfC8fX6XdSAenmaZh   --profile dev
aws configure set aws_session_token     "IQoJb3JpZ2luX2VjECEaCXVzLXdlc3QtMiJHMEUCIH7aMOjRHuyJrXC3Teq26vWGYVhJ606VNRA/iil6DrG2AiEA5bivp15l+Oa18zfCM1Tf0cwjns3oa7XipLcByThTG5wqwwIIqv//////////ARAAGgwzMzk3MTMxNTE4MjUiDCwJg/iyWuSYD9dOLiqXAvGEblZgOgczoRepN7Wx7ms8E+RCzzHCxfTVaLM5L6owAB46vTJLe1OqE4RlCFVsy16awH4OYOIIFZ4vJo7Wz/HdxA4nB3WJ727RxfpX6eSiSzTQpAkU/YI9GKkz4zcm9b30wn7z2Nqs2i1udxMMhinQ/fOhH2OCqyuG1/RQjrD9a/zn7c8eeIa1LoGJK8XBufQeXmm5FHvey30xTSEWiHNYg7dIZ1CkcB9jNnoyFy7jqKjxpLfqmh+IA1xxmiU31QIqvVKgpiXFe93q/gwiBlcgy8IJlkEG+yekUtZlEqDkYPkCpHvuppATcDgJTAxc3AdTfdoT5hhTumYGQRBsGE3fOw6n7RH66k0cYIDaMgvRkSvgyxE9IDC4t+DGBjqdAUZhcEp5ZEYU5bDXzHLAohThaGHIAQ51WRU4/SwqR6ePe+N0x04FZJaE/DFPny9PCWvbLn0Yv+Sn8mCR36dz92+zpJ+mMgMYHWOXoguKtHujF5slFVJgFbstOaljyGHmeqY9C/8llhmhFeONiRm/qmMpFRl41FshmB+7ldJXxSjZcU9HDt4CdGzcJy8VnoWDb1/jYvng7XwrOTx3k3I="      --profile dev
aws configure set region                us-east-1                 --profile dev
aws configure set output                json                      --profile dev


use dev identity and the call to check:
$env:AWS_PROFILE = "dev"
aws sts get-caller-identity


Once set up:
- SSH into the db first to create. Use the private key and then IP addr
- Get the db password from secrets manager
- to get jwt token:

https://spirulina-dev-auth.auth.us-east-1.amazoncognito.com/login
  ?client_id={YOUR_CLIENT_ID}
  &response_type=token
  &scope=openid+email+phone
  &redirect_uri=https%3A%2F%2Fd84l1y8p4kdic.cloudfront.net%2F
- copy the id 