import sys
sys.argv = ['backend_soc_django.py']
import backend_soc_django
from django.contrib.auth.models import User
admin = User.objects.get(username='admin')
profile, created = backend_soc_django.UserProfile.objects.get_or_create(user=admin)
profile.role = 'admin'
profile.save()
print("✅ Perfil de administrador arreglado.")
