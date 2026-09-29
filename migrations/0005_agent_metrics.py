from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('__main__', '0004_userprofile_telegram_preferences'),
    ]

    operations = [
        migrations.AddField(
            model_name='agent',
            name='cpu_usage',
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='agent',
            name='memory_usage',
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='agent',
            name='disk_usage',
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='agent',
            name='metrics_updated_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]